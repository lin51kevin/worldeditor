/**
 * Frame rendering + snapshot capture — extracted from renderer.ts to keep the
 * ViewportRenderer class under the file-size budget.
 *
 * These functions operate on the renderer instance via the {@link RendererFrameInternals}
 * structural interface (the renderer passes `this`). All members listed here are
 * owned by ViewportRenderer; this module only orchestrates the per-frame GPU work.
 */
import { batchMeshes } from './meshBatcher';
import type { RenderableMesh } from './markerRenderer';
import type { CameraController } from './cameraController';
import type { MarkerRenderer } from './markerRenderer';
import type { SpriteRenderer } from './spriteRenderer';

/** Subset of ViewportRenderer state/methods needed for frame rendering + capture. */
export interface RendererFrameInternals {
  deviceLost: boolean;
  disposed: boolean;
  context: GPUCanvasContext;
  device: GPUDevice;
  cameraController: CameraController;
  gridUniformData: Float32Array<ArrayBuffer>;
  gridColor: [number, number, number];
  showGrid: boolean;
  showAxis: boolean;
  gridUniformBuffer: GPUBuffer;
  basicUniformData: Float32Array<ArrayBuffer>;
  basicUniformBuffer: GPUBuffer;
  msaaTexture: GPUTexture | null;
  depthTexture: GPUTexture;
  clearColor: { r: number; g: number; b: number; a: number };
  gridPipeline: GPURenderPipeline;
  gridBindGroup: GPUBindGroup;
  pointCloudMeshes: RenderableMesh[];
  pointCloudPipeline: GPURenderPipeline | null;
  basicBindGroup: GPUBindGroup;
  meshes: RenderableMesh[];
  basicPipeline: GPURenderPipeline;
  hoverMeshes: RenderableMesh[];
  highlightPipeline: GPURenderPipeline;
  linkHighlightMeshes: RenderableMesh[];
  highlightMeshes: RenderableMesh[];
  overlayMeshes: RenderableMesh[];
  laneLineMeshes: RenderableMesh[];
  spriteRenderer: SpriteRenderer | null;
  width: number;
  height: number;
  markerRenderer: MarkerRenderer;
  overlayRenderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void>;
  overlayCanvas: HTMLCanvasElement | null;
  sceneDirty: boolean;
  lastVertexData: Float32Array | null;
  markSceneDirty(): void;
}

/** Draw a list of meshes with the given pipeline, batched by the supplied key. */
function drawBatched(
  pass: GPURenderPassEncoder,
  meshes: readonly RenderableMesh[],
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  key: 'basic' | 'highlight',
): void {
  if (meshes.length === 0) return;
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  const batches = batchMeshes(meshes, key);
  for (const batch of batches) {
    for (const mesh of batch.meshes) {
      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.draw(mesh.vertexCount);
    }
  }
}

/** Render a single frame to the swap chain (render-on-demand). */
export function renderFrame(r: RendererFrameInternals): void {
  if (r.deviceLost || r.disposed) return;

  let texture: GPUTexture;
  try {
    texture = r.context.getCurrentTexture();
  } catch {
    // Canvas/context may be in an invalid state (tab hidden, resize race)
    return;
  }

  const camera = r.cameraController.state;
  const wasDirty = r.cameraController.isViewDirty;
  const viewProj = r.cameraController.computeViewProj();

  // Only update uniforms when camera has changed (skip redundant GPU writes)
  if (wasDirty) {
    // Update grid uniforms (96 bytes: mat4x4 + vec3 + f32 + vec3 + f32)
    const gridData = r.gridUniformData;
    gridData.set(viewProj, 0);
    gridData.set(camera.position, 16);
    gridData[19] = r.cameraController.currentGridSpacing;
    gridData.set(r.gridColor, 20);
    gridData[23] = r.cameraController.getGridFadeDistance();
    gridData[24] = r.showGrid ? 1.0 : 0.0;
    gridData[25] = r.showAxis ? 1.0 : 0.0;
    r.device.queue.writeBuffer(r.gridUniformBuffer, 0, gridData);

    // Update basic uniforms (128 bytes: mat4x4 view_proj + mat4x4 model)
    const basicData = r.basicUniformData;
    basicData.set(viewProj, 0);
    // Identity model matrix
    basicData[16] = 1; basicData[21] = 1; basicData[26] = 1; basicData[31] = 1;
    r.device.queue.writeBuffer(r.basicUniformBuffer, 0, basicData);
  }

  const encoder = r.device.createCommandEncoder();

  const swapChainView = texture.createView();
  const msaaView = r.msaaTexture?.createView() ?? swapChainView;
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: msaaView,
      resolveTarget: r.msaaTexture ? swapChainView : undefined,
      clearValue: r.clearColor,
      loadOp: 'clear',
      storeOp: r.msaaTexture ? 'discard' : 'store',
    }],
    depthStencilAttachment: {
      view: r.depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  // Draw grid
  if (r.showGrid || r.showAxis) {
    pass.setPipeline(r.gridPipeline);
    pass.setBindGroup(0, r.gridBindGroup);
    pass.draw(6);
  }

  // Draw point cloud (behind roads, on top of grid)
  if (r.pointCloudMeshes.length > 0 && r.pointCloudPipeline) {
    pass.setPipeline(r.pointCloudPipeline);
    pass.setBindGroup(0, r.basicBindGroup);
    for (const mesh of r.pointCloudMeshes) {
      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.draw(mesh.vertexCount);
    }
  }

  // Draw road meshes (render first - on bottom)
  drawBatched(pass, r.meshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw hover highlight (above road surface, below selection so selection overrides)
  drawBatched(pass, r.hoverMeshes, r.highlightPipeline, r.basicBindGroup, 'highlight');

  // Draw road link (predecessor/successor) highlight
  drawBatched(pass, r.linkHighlightMeshes, r.highlightPipeline, r.basicBindGroup, 'highlight');

  // Draw selection highlight (on top of road surface, below markings)
  drawBatched(pass, r.highlightMeshes, r.highlightPipeline, r.basicBindGroup, 'highlight');

  // Draw bridge/tunnel overlays (above road surface, below lane lines)
  drawBatched(pass, r.overlayMeshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw lane lines (between road surface and markings)
  drawBatched(pass, r.laneLineMeshes, r.highlightPipeline, r.basicBindGroup, 'highlight');

  // Draw road paint textured quads (arrows on road surface)
  if (r.spriteRenderer?.hasContent()) {
    // Refresh bind groups if textures finished loading since last frame
    if (r.spriteRenderer.refreshBindGroups()) {
      r.markSceneDirty();
    }
    r.spriteRenderer.updateUniforms(
      r.cameraController.computeViewProj(),
      r.width, r.height,
      // Pass pixels-per-meter so billboard offsets (in world units) scale with zoom.
      1.0 / r.cameraController.getMetersPerPixel(),
    );
    r.spriteRenderer.renderPaints(pass);
    r.spriteRenderer.renderSprites(pass);
  }

  // Draw spline preview curve on top of road surface
  drawBatched(pass, r.markerRenderer.curveMeshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw spline control point markers (screen-size constant squares)
  drawBatched(pass, r.markerRenderer.markerMeshes, r.basicPipeline, r.basicBindGroup, 'basic');

  pass.end();
  try {
    r.device.queue.submit([encoder.finish()]);
  } catch {
    // Transient D3D swap-chain / device-context mismatch; skip frame.
    // This can occur during resize or when the window moves between monitors.
  }

  // Invoke plugin overlay renderers after main render pass
  if (r.overlayRenderers.length > 0) {
    const ctx = { device: r.device, canvas: r.overlayCanvas ?? undefined };
    for (const render of r.overlayRenderers) {
      try { render(ctx); } catch { /* plugin errors must not crash the render loop */ }
    }
  }
}

/**
 * Force a synchronous render and immediately capture the canvas content as a
 * PNG data URL (null on failure).
 *
 * @param options.transparent - If true, renders with transparent clear color
 *   and excludes grid/axis so the export has a clean transparent background.
 * @param options.fitToContent - If true, temporarily fits the camera to show
 *   all road content before rendering, then restores the original camera.
 */
export function captureFrame(
  r: RendererFrameInternals,
  options?: { transparent?: boolean; fitToContent?: boolean },
): string | null {
  if (r.deviceLost || r.disposed) return null;

  // Save state that we temporarily override for capture
  const prevShowGrid = r.showGrid;
  const prevShowAxis = r.showAxis;
  const prevClearColor = r.clearColor;

  // Save camera state if we need to fit to content
  const savedCameraState = options?.fitToContent
    ? r.cameraController.saveState()
    : null;

  // Always hide grid and axis for snapshot export
  r.showGrid = false;
  r.showAxis = false;

  // When transparent, use a fully transparent clear color
  if (options?.transparent) {
    r.clearColor = { r: 0, g: 0, b: 0, a: 0 };
  }

  // Fit camera to show all content at appropriate zoom level
  if (options?.fitToContent && r.lastVertexData) {
    r.cameraController.fitToVertices(r.lastVertexData);
  }

  // Force a render
  r.sceneDirty = true;
  r.cameraController.isViewDirty = true;
  renderFrame(r);

  // Restore state
  r.showGrid = prevShowGrid;
  r.showAxis = prevShowAxis;
  r.clearColor = prevClearColor;
  if (savedCameraState) {
    r.cameraController.restoreState(savedCameraState);
  }

  // Immediately read back — the texture is still valid in this microtask
  try {
    const canvas = r.context?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
