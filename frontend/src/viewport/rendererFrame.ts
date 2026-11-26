/**
 * Frame rendering + snapshot capture — extracted from renderer.ts to keep the
 * ViewportRenderer class under the file-size budget.
 *
 * These functions operate on the renderer instance via the {@link RendererFrameInternals}
 * structural interface (the renderer passes `this`). All members listed here are
 * owned by ViewportRenderer; this module only orchestrates the per-frame GPU work.
 */
import { batchMeshes } from './meshBatcher';
import { LANE_RIBBON_MIN_HALF_PX } from './pipelineFactory';
import type { RenderableMesh } from './markerRenderer';
import type { CameraController } from './cameraController';
import type { MarkerRenderer } from './markerRenderer';
import type { SpriteRenderer } from './spriteRenderer';
import type { SplatRenderer } from './gaussian/splatRenderer';
import type { ActorSplatInstancer } from './gaussian/actorSplatInstancer';

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
  actorPointCloudMeshes: RenderableMesh[];
  groundMesh: { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexCount: number } | null;
  egoMesh: { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexCount: number } | null;
  splatRenderer: SplatRenderer | null;
  actorSplatRenderer: SplatRenderer | null;
  actorSplatInstancer: ActorSplatInstancer | null;
  basicBindGroup: GPUBindGroup;
  meshes: RenderableMesh[];
  junctionMeshes: RenderableMesh[];
  basicPipeline: GPURenderPipeline;
  actorPipeline: GPURenderPipeline;
  actorDepthWritePipeline: GPURenderPipeline;
  actorDepthWrite: boolean;
  actorOverlayPipeline: GPURenderPipeline;
  hoverMeshes: RenderableMesh[];
  highlightPipeline: GPURenderPipeline;
  linkHighlightMeshes: RenderableMesh[];
  highlightMeshes: RenderableMesh[];
  overlayMeshes: RenderableMesh[];
  actorMeshes: RenderableMesh[];
  actorOverlayMeshes: RenderableMesh[];
  pathMeshes: RenderableMesh[];
  laneLineMeshes: RenderableMesh[];
  laneRibbonMeshes: RenderableMesh[];
  laneRibbonPipeline: GPURenderPipeline;
  laneRibbonBindGroup: GPUBindGroup;
  laneRibbonUniformBuffer: GPUBuffer;
  laneRibbonUniformData: Float32Array<ArrayBuffer>;
  spriteRenderer: SpriteRenderer | null;
  width: number;
  height: number;
  /** Device pixels per CSS pixel; `width`/`height` are device pixels. */
  pixelRatio: number;
  markerRenderer: MarkerRenderer;
  overlayRenderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void>;
  overlayCanvas: HTMLCanvasElement | null;
  sceneDirty: boolean;
  staticSceneVisible: boolean;
  sceneSplatsVisible: boolean;
  lastVertexData: Float32Array | null;
  format: GPUTextureFormat;
  staticRevision: number;
  staticLayerCacheEnabled: boolean;
  staticLayerCache: StaticLayerCache | null;
  markSceneDirty(): void;
}

/**
 * Offscreen copy of the static layer (roads, static scene, scene splats and their
 * occluder depth) together with what it was drawn for. While none of that
 * changed, a frame copies it back and draws only the dynamic layer on top.
 */
export interface StaticLayerCache {
  color: GPUTexture;
  depth: GPUTexture;
  width: number;
  height: number;
  valid: boolean;
  viewProj: Float32Array;
  revision: number;
  sortRevision: number;
  stateKey: string;
}

/** Below this many scene splats a full redraw is cheaper than keeping the cache. */
export const STATIC_LAYER_CACHE_MIN_SPLATS = 1_000_000;

export function disposeStaticLayerCache(cache: StaticLayerCache | null): null {
  cache?.color.destroy();
  cache?.depth.destroy();
  return null;
}

function createStaticLayerCache(r: RendererFrameInternals): StaticLayerCache {
  const size = [r.width, r.height];
  return {
    color: r.device.createTexture({
      size,
      format: r.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }),
    depth: r.device.createTexture({
      size,
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }),
    width: r.width,
    height: r.height,
    valid: false,
    viewProj: new Float32Array(16),
    revision: -1,
    sortRevision: -1,
    stateKey: '',
  };
}

/** Static-layer inputs that are toggled without going through `markSceneDirty`. */
function staticStateKey(r: RendererFrameInternals): string {
  const c = r.clearColor;
  return `${c.r},${c.g},${c.b},${c.a}|${r.showGrid}|${r.showAxis}`;
}

/**
 * Only worth it for a heavy scene, and only when nothing dynamic is drawn in the
 * middle of the static layer (actor point clouds / ego mesh sit between the roads).
 */
export function isStaticLayerCacheable(r: RendererFrameInternals, texture: GPUTexture): boolean {
  const scene = r.splatRenderer;
  return (
    r.staticLayerCacheEnabled &&
    !r.msaaTexture &&
    !!scene?.hasContent &&
    scene.count >= STATIC_LAYER_CACHE_MIN_SPLATS &&
    !scene.uploading &&
    r.staticSceneVisible &&
    r.sceneSplatsVisible &&
    r.actorPointCloudMeshes.length === 0 &&
    !r.egoMesh &&
    texture.width === r.width &&
    texture.height === r.height
  );
}

function sameMatrix(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

function renderWithStaticLayerCache(
  r: RendererFrameInternals,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  viewProj: ArrayLike<number>,
): void {
  let cache = r.staticLayerCache;
  if (cache && (cache.width !== r.width || cache.height !== r.height)) cache = disposeStaticLayerCache(cache);
  if (!cache) {
    cache = createStaticLayerCache(r);
    r.staticLayerCache = cache;
  }
  const sortRevision = r.splatRenderer?.orderRevision ?? 0;
  const stateKey = staticStateKey(r);
  const fresh =
    cache.valid &&
    cache.revision === r.staticRevision &&
    cache.sortRevision === sortRevision &&
    cache.stateKey === stateKey &&
    sameMatrix(cache.viewProj, viewProj);
  if (!fresh) {
    // Read before drawing: anything the draw itself dirties must invalidate the next frame.
    const revision = r.staticRevision;
    const staticPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: cache.color.createView(),
        clearValue: r.clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: cache.depth.createView(),
        depthClearValue: 0.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    drawStaticLayer(r, staticPass);
    staticPass.end();
    cache.valid = true;
    cache.revision = revision;
    cache.sortRevision = sortRevision;
    cache.stateKey = stateKey;
    cache.viewProj.set(viewProj);
  }

  const size = [r.width, r.height];
  encoder.copyTextureToTexture({ texture: cache.color }, { texture }, size);
  encoder.copyTextureToTexture({ texture: cache.depth }, { texture: r.depthTexture }, size);
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: texture.createView(), loadOp: 'load', storeOp: 'store' }],
    depthStencilAttachment: {
      view: r.depthTexture.createView(),
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  });
  drawDynamicLayer(r, pass);
  pass.end();
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

    // Lane ribbons (80 bytes: mat4x4 view_proj + vec2 viewport_px + min_half_px + pad)
    const ribbonData = r.laneRibbonUniformData;
    ribbonData.set(viewProj, 0);
    ribbonData[16] = r.width;
    ribbonData[17] = r.height;
    ribbonData[18] = LANE_RIBBON_MIN_HALF_PX;
    r.device.queue.writeBuffer(r.laneRibbonUniformBuffer, 0, ribbonData);
  }

  // Refresh the Gaussian splat camera uniform + schedule a depth re-sort. The
  // sort is internally thresholded, so a static camera costs almost nothing.
  // Scene and actor clouds are sorted independently (each owns its order buffer).
  if (r.splatRenderer?.hasContent) {
    r.splatRenderer.onCamera(
      camera,
      r.cameraController.dimension,
      r.pixelRatio / r.cameraController.getMetersPerPixel(),
      r.width,
      r.height,
      viewProj,
    );
  }
  if (r.actorSplatRenderer?.hasContent) {
    r.actorSplatRenderer.onCamera(
      camera,
      r.cameraController.dimension,
      r.pixelRatio / r.cameraController.getMetersPerPixel(),
      r.width,
      r.height,
      viewProj,
    );
  }
  if (r.actorSplatInstancer?.hasContent) {
    r.actorSplatInstancer.onCamera(
      camera,
      r.cameraController.dimension,
      r.pixelRatio / r.cameraController.getMetersPerPixel(),
      r.width,
      r.height,
      viewProj,
    );
  }

  const encoder = r.device.createCommandEncoder();

  // Optional GPU compute sort: writes each cloud's order buffer in-encoder,
  // before the render pass reads it. Returns false when disabled or ineligible
  // (packed fallback / no compute), leaving the async CPU worker sort in charge.
  if (r.splatRenderer?.hasContent) r.splatRenderer.sortGpu(encoder);
  if (r.actorSplatRenderer?.hasContent) r.actorSplatRenderer.sortGpu(encoder);
  // actorSplatInstancer uses its own CPU-worker sort (no GPU compute sort path yet).

  if (isStaticLayerCacheable(r, texture)) {
    renderWithStaticLayerCache(r, encoder, texture, viewProj);
  } else {
    r.staticLayerCache = disposeStaticLayerCache(r.staticLayerCache);
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
        depthClearValue: 0.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    drawStaticLayer(r, pass);
    drawDynamicLayer(r, pass);
    pass.end();
  }

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

/** Everything up to and including the static scene splats and their occluder depth. */
function drawStaticLayer(r: RendererFrameInternals, pass: GPURenderPassEncoder): void {
  // Draw grid
  if (r.showGrid || r.showAxis) {
    pass.setPipeline(r.gridPipeline);
    pass.setBindGroup(0, r.gridBindGroup);
    pass.draw(6);
  }

  // Draw point cloud (behind roads, on top of grid)
  if ((r.pointCloudMeshes.length > 0 || r.actorPointCloudMeshes.length > 0) && r.pointCloudPipeline) {
    pass.setPipeline(r.pointCloudPipeline);
    pass.setBindGroup(0, r.basicBindGroup);
    // Static scene cloud is gated by visibility; actor clouds always draw.
    if (r.staticSceneVisible) {
      for (const mesh of r.pointCloudMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }
    // Opponent (NPC) model clouds share the pipeline but live in a separate buffer.
    for (const mesh of r.actorPointCloudMeshes) {
      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.draw(mesh.vertexCount);
    }
  }

  // Draw the ground surface triangle mesh (e.g. road_mesh.glb) as an opaque,
  // vertex-colored floor beneath the roads. Uses the basic pipeline with an
  // indexed draw.
  if (r.groundMesh && r.staticSceneVisible) {
    pass.setPipeline(r.basicPipeline);
    pass.setBindGroup(0, r.basicBindGroup);
    pass.setVertexBuffer(0, r.groundMesh.vertexBuffer);
    pass.setIndexBuffer(r.groundMesh.indexBuffer, 'uint32');
    pass.drawIndexed(r.groundMesh.indexCount);
  }

  // Draw the ego vehicle model (transformed `ego.glb`) as an opaque, indexed,
  // vertex-colored solid so the ego actor is clearly distinct from the
  // translucent opponent bounding boxes drawn later.
  if (r.egoMesh) {
    pass.setPipeline(r.basicPipeline);
    pass.setBindGroup(0, r.basicBindGroup);
    pass.setVertexBuffer(0, r.egoMesh.vertexBuffer);
    pass.setIndexBuffer(r.egoMesh.indexBuffer, 'uint32');
    pass.drawIndexed(r.egoMesh.indexCount);
  }

  // Draw road meshes (render first - on bottom)
  drawBatched(pass, r.meshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw junction fill (above road surface, below everything else). Uses the
  // depth-biased highlight pipeline (depthWriteEnabled=false, depthBias) so the
  // translucent fill never z-fights the coplanar road surface and never occludes
  // lane lines / objects / signals that are drawn afterwards.
  drawBatched(pass, r.junctionMeshes, r.highlightPipeline, r.basicBindGroup, 'highlight');

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
  drawBatched(pass, r.laneRibbonMeshes, r.laneRibbonPipeline, r.laneRibbonBindGroup, 'highlight');

  // Draw road paint textured quads (arrows on road surface)
  if (r.spriteRenderer?.hasContent()) {
    // Refresh bind groups if textures finished loading since last frame
    if (r.spriteRenderer.refreshBindGroups()) {
      r.markSceneDirty();
    }
    r.spriteRenderer.updateUniforms(
      r.cameraController.computeViewProj(),
      // Projection x/y scale: billboard offsets are world meters, so sprites keep
      // their real size and shrink with distance instead of a fixed pixel size.
      ...r.cameraController.getProjectionScale(),
    );
    r.spriteRenderer.renderPaints(pass);
    r.spriteRenderer.renderSprites(pass);
  }

  // Draw spline preview curve on top of road surface
  drawBatched(pass, r.markerRenderer.curveMeshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw spline control point markers (screen-size constant squares)
  drawBatched(pass, r.markerRenderer.markerMeshes, r.basicPipeline, r.basicBindGroup, 'basic');

  // Draw 3D Gaussian splats last: translucent, back-to-front sorted, and still
  // depth-tested (reverse-Z 'greater', no write) so opaque geometry occludes
  // them correctly. Scene splats first, then actor (NPC/ego) splats on top so
  // dynamic vehicles composite over the static reconstructed scene.
  const sceneSplats = r.staticSceneVisible && r.sceneSplatsVisible;
  if (sceneSplats) r.splatRenderer?.draw(pass);
  // Seed the depth buffer with the static scene's opaque cores so the actor
  // splats below are hidden where a building/tree stands between them and the
  // camera. Colour writes are masked, so the scene's own render is untouched.
  // Note: the trajectory-ribbon/bounding-box passes below also depth-test
  // ('greater'), so this depth is load-bearing even with no actor splats.
  if (sceneSplats) r.splatRenderer?.drawDepthOnly(pass);
}

/** Actor splats, trajectory ribbons, boxes and gizmos: drawn every frame on top of the static layer. */
function drawDynamicLayer(r: RendererFrameInternals, pass: GPURenderPassEncoder): void {
  r.actorSplatRenderer?.draw(pass);
  r.actorSplatInstancer?.draw(pass);

  // Case-actor trajectory ribbons + bounding boxes are editor overlays, so they
  // are drawn AFTER every splat pass. Their pipeline never writes depth (the
  // translucent box fill must not self-occlude under reverse-Z), which means a
  // splat drawn later would blend straight over them — the box survived only
  // where a splat happened to be depth-rejected by the OpenDRIVE road surface,
  // so it looked fragmentary and vanished entirely once the map was hidden.
  const actorPipeline = r.actorDepthWrite ? r.actorDepthWritePipeline : r.actorPipeline;
  drawBatched(pass, r.pathMeshes, actorPipeline, r.basicBindGroup, 'basic');
  drawBatched(pass, r.actorMeshes, actorPipeline, r.basicBindGroup, 'basic');

  // Editor manipulators (transform gizmos) go last with the depth test off, so
  // they stay visible — and therefore grabbable — through the road surface, the
  // point cloud and the reconstructed splat scene.
  drawBatched(pass, r.actorOverlayMeshes, r.actorOverlayPipeline, r.basicBindGroup, 'basic');
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
