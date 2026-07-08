/**
 * High-level facade tying the Gaussian splat GPU resources to the depth sorter.
 *
 * The renderer owns one `SplatRenderer`, calls {@link upload} when an NPC splat
 * cloud loads, {@link onCamera} once per frame (which refreshes the uniform and
 * schedules a re-sort when the camera moved), and {@link draw} inside the main
 * render pass after opaque geometry.
 */
import {
  GaussianSplatResources,
  splatStrideForDegree,
  createGaussianSplatPipeline,
} from "./splatPipeline";
import { SplatSortController, type SplatSorter } from "./splatSortController";
import { createWorkerSplatSorter } from "./splatSorterBackends";
import { buildSplatUniform } from "./splatUniform";
import type { Vec3 } from "./splatSort";
import type { CameraState } from "../cameraController";

/**
 * Extract the interleaved `[x,y,z,...]` positions from a packed splat buffer.
 * `stride` is the per-splat float count (varies with SH degree).
 */
export function extractSplatPositions(
  splatData: Float32Array,
  stride: number,
): Float32Array {
  const n = Math.floor(splatData.length / stride);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = splatData[i * stride]!;
    pos[i * 3 + 1] = splatData[i * stride + 1]!;
    pos[i * 3 + 2] = splatData[i * stride + 2]!;
  }
  return pos;
}

/** Normalized view direction `target - position`; falls back to +Z if degenerate. */
export function computeViewDir(position: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return [0, 0, 1];
  return [dx / len, dy / len, dz / len];
}

/** Orchestrates upload, per-frame uniform/sort updates, and drawing of splats. */
export class SplatRenderer {
  private readonly resources: GaussianSplatResources;
  private readonly sort: SplatSortController;
  /** 2D low-pass filter size (px²); larger = fuller/blurrier splats. */
  private dilation = 0.15;

  constructor(
    device: GPUDevice,
    bindGroupLayout: GPUBindGroupLayout,
    private readonly pipeline: GPURenderPipeline,
    sorter: SplatSorter,
    /**
     * Called after a fresh depth-sorted order is uploaded. The renderer wires
     * this to `markSceneDirty` so the (asynchronously produced) sorted order is
     * actually drawn — critical under render-on-demand, where a static camera
     * would otherwise keep showing the initial identity order.
     */
    private readonly onOrderChanged?: () => void,
  ) {
    this.resources = new GaussianSplatResources(device, bindGroupLayout);
    this.sort = new SplatSortController(sorter, (idx) => {
      this.resources.updateOrder(idx);
      this.onOrderChanged?.();
    });
  }

  /** Whether there are splats to draw. */
  get hasContent(): boolean {
    return this.resources.hasContent;
  }

  /** Number of splats currently loaded. */
  get count(): number {
    return this.resources.count;
  }

  /** Upload a packed SH splat buffer (stride varies with degree) and prime the sorter. */
  upload(splatData: Float32Array, shDegree: number): void {
    this.resources.upload(splatData, shDegree);
    const stride = splatStrideForDegree(shDegree);
    this.sort.setSplats(extractSplatPositions(splatData, stride));
  }

  /** Set the 2D low-pass dilation (splat fullness). Wakes a redraw. */
  setDilation(dilation: number): void {
    this.dilation = Math.max(0, dilation);
    this.onOrderChanged?.();
  }

  /** Per-frame update: refresh the camera uniform and re-sort if needed. */
  onCamera(
    camera: CameraState,
    dimensionMode: "2d" | "3d",
    numPixelsPerMeter: number,
    width: number,
    height: number,
  ): void {
    if (!this.resources.hasContent) return;
    const uniform = buildSplatUniform(
      camera,
      dimensionMode,
      numPixelsPerMeter,
      width,
      height,
      this.resources.shDegree,
      this.dilation,
    );
    this.resources.updateUniform(uniform);
    const viewDir = computeViewDir(camera.position, camera.target);
    this.sort.onCamera(camera.position, viewDir);
  }

  /** Draw the splats into the active render pass (after opaque geometry). */
  draw(pass: GPURenderPassEncoder): void {
    this.resources.draw(pass, this.pipeline);
  }

  /** Remove the current cloud. */
  clear(): void {
    this.resources.clear();
    this.sort.setSplats(new Float32Array(0));
  }

  /** Force a re-sort next frame (e.g. after a projection change). */
  invalidateSort(): void {
    this.sort.invalidate();
  }

  /** Release all GPU + worker resources. */
  dispose(): void {
    this.resources.dispose();
    this.sort.dispose();
  }
}

/**
 * Convenience constructor: create the pipeline and a worker-backed
 * `SplatRenderer` in one call.
 */
export function createSplatRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  sampleCount = 4,
  onOrderChanged?: () => void,
): SplatRenderer {
  const { pipeline, bindGroupLayout } = createGaussianSplatPipeline(
    device,
    format,
    sampleCount,
  );
  return new SplatRenderer(
    device,
    bindGroupLayout,
    pipeline,
    createWorkerSplatSorter(),
    onOrderChanged,
  );
}
