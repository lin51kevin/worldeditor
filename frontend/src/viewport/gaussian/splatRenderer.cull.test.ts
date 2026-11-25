import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sortSpy = vi.fn();
vi.mock("./splatSortCompute", () => ({
  MAX_WORKGROUPS_PER_DIM: 65535,
  GpuSplatSorter: class {
    drawArgsBuffer = { label: "draw-args" };
    resize = vi.fn();
    sort = sortSpy;
    dispose = vi.fn();
  },
}));

import { SplatRenderer } from "./splatRenderer";
import { splatStrideForDegree } from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";
import type { SplatSorter } from "./splatSortController";
import type { CameraState } from "../cameraController";

const camera = {
  position: [0, -10, 5],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fovY: Math.PI / 4,
  near: 0.1,
  far: 1000,
} as CameraState;

function device(): GPUDevice {
  return {
    createBuffer: (d: { size: number }) => ({
      size: d.size,
      destroy() {},
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new Uint32Array([4, 1234, 0, 0]).buffer,
      unmap() {},
    }),
    createCommandEncoder: () => ({ copyBufferToBuffer: vi.fn(), finish: () => ({}) }),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createBindGroup: () => ({}),
    createComputePipeline: () => ({}),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn(), submit: vi.fn() },
    limits: {
      maxTextureDimension2D: 64,
      maxTextureArrayLayers: 256,
      maxBufferSize: 1_073_741_824,
      maxStorageBufferBindingSize: 1_073_741_824,
    },
  } as unknown as GPUDevice;
}

const idleSorter: SplatSorter = { init() {}, sort() {}, dispose() {} };

function makeRenderer(): SplatRenderer {
  const r = new SplatRenderer(device(), {} as GPUBindGroupLayout, {} as GPURenderPipeline, idleSorter);
  r.upload(new Uint32Array(4 * splatStrideForDegree(0)), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
  r.setGpuSort(true);
  return r;
}

describe("SplatRenderer GPU sort frustum culling", () => {
  let now = 1000;
  beforeEach(() => {
    sortSpy.mockClear();
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  it("hands the sort the render uniform and per-splat radii to cull against", () => {
    const r = makeRenderer();
    r.onCamera(camera, "3d", 50, 800, 600);
    expect(r.sortGpu({} as GPUCommandEncoder)).toBe(true);

    expect(sortSpy).toHaveBeenCalledTimes(1);
    const cull = sortSpy.mock.calls[0]![7] as { uniformBuffer: unknown; radiiBuffer: unknown; guardNdc: number };
    expect(cull.uniformBuffer).toBeDefined();
    expect(cull.radiiBuffer).toBeDefined();
    expect(cull.guardNdc).toBeGreaterThan(0);
  });

  it("skips the sort for an identical frame", () => {
    const r = makeRenderer();
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    now += 1000;
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy).toHaveBeenCalledTimes(1);
  });

  it("re-sorts when only the viewport changes, because the cull depends on it", () => {
    const r = makeRenderer();
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    now += 1000;
    r.onCamera(camera, "3d", 50, 1600, 600);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy).toHaveBeenCalledTimes(2);
  });

  it("reads back how many splats the last sort kept", async () => {
    const r = makeRenderer();
    expect(await r.readVisibleCount()).toBeNull();
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);

    expect(await r.readVisibleCount()).toBe(1234);
  });

  it("sorts without cull inputs once frustum culling is disabled", () => {
    const r = makeRenderer();
    r.setFrustumCull(false);
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy.mock.calls[0]![7]).toBeUndefined();

    now += 1000;
    r.setFrustumCull(true);
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy).toHaveBeenCalledTimes(2);
    expect(sortSpy.mock.calls[1]![7]).toBeDefined();
  });

  it("re-sorts when only the field of view changes", () => {
    const r = makeRenderer();
    r.onCamera(camera, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    now += 1000;
    r.onCamera({ ...camera, fovY: Math.PI / 3 } as CameraState, "3d", 50, 800, 600);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy).toHaveBeenCalledTimes(2);
  });
});

describe("SplatRenderer interactive budget", () => {
  let now = 1000;
  beforeEach(() => {
    vi.useFakeTimers();
    sortSpy.mockClear();
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function make(budget: number) {
    const wake = vi.fn();
    const r = new SplatRenderer(device(), {} as GPUBindGroupLayout, {} as GPURenderPipeline, idleSorter, wake);
    r.upload(new Uint32Array(4 * splatStrideForDegree(0)), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    r.setGpuSort(true);
    r.setInteractiveBudget(budget);
    return { r, wake };
  }
  const at = (r: SplatRenderer, x: number): void =>
    r.onCamera({ ...camera, position: [x, -10, 5] } as CameraState, "3d", 50, 800, 600);
  const tauOf = (call: number): number => (sortSpy.mock.calls[call]![7] as { thinTau?: number }).thinTau ?? 0;

  it("does not thin without a budget", () => {
    const { r } = make(0);
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    expect(tauOf(0)).toBe(0);
  });

  it("does not thin a cloud that already fits the budget", () => {
    const { r } = make(100);
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    expect(tauOf(0)).toBe(0);
  });

  it("thins a moving camera over a cloud larger than the budget", () => {
    const { r } = make(2);
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    expect(tauOf(0)).toBeGreaterThan(0);
  });

  it("raises the threshold from the visible count measured after the sort", async () => {
    const { r } = make(2);
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    await vi.advanceTimersByTimeAsync(0);

    now += 1000;
    at(r, 1);
    r.sortGpu({} as GPUCommandEncoder);
    expect(tauOf(1)).toBeGreaterThan(tauOf(0));
  });

  it("re-sorts at full quality once the camera has settled", async () => {
    const { r, wake } = make(2);
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    wake.mockClear();

    await vi.advanceTimersByTimeAsync(1000);
    expect(wake).toHaveBeenCalled();

    now += 1000;
    at(r, 0);
    r.sortGpu({} as GPUCommandEncoder);
    expect(sortSpy).toHaveBeenCalledTimes(2);
    expect(tauOf(1)).toBe(0);
  });

  describe("interactive hold (animation under a still camera)", () => {
    it("keeps the budgeted order after the camera settles instead of refining", async () => {
      const { r } = make(2);
      r.setInteractiveHold(true);
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      await vi.advanceTimersByTimeAsync(1000);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      const last = sortSpy.mock.calls.length - 1;
      expect(tauOf(last)).toBeGreaterThan(0);
    });

    it("re-sorts a still camera at the budget as soon as the hold starts", async () => {
      const { r } = make(2);
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      await vi.advanceTimersByTimeAsync(1000);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      expect(tauOf(1)).toBe(0); // settled: full quality

      r.setInteractiveHold(true);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      expect(sortSpy).toHaveBeenCalledTimes(3);
      expect(tauOf(2)).toBeGreaterThan(0);
    });

    it("returns to full quality right away when the hold is released", async () => {
      const { r } = make(2);
      r.setInteractiveHold(true);
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      r.setInteractiveHold(false);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      expect(sortSpy).toHaveBeenCalledTimes(2);
      expect(tauOf(1)).toBe(0);
    });

    it("keeps correcting the threshold from the measured count while the camera is still", async () => {
      const { r } = make(2);
      r.setInteractiveHold(true);
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      await vi.advanceTimersByTimeAsync(0);

      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      expect(sortSpy).toHaveBeenCalledTimes(2);
      expect(tauOf(1)).toBeGreaterThan(tauOf(0));
    });

    it("does nothing for a cloud that fits the budget", () => {
      const { r, wake } = make(100);
      wake.mockClear();
      r.setInteractiveHold(true);
      expect(wake).not.toHaveBeenCalled();
    });
  });

  describe("settled budget (caps the full-quality frame of a huge cloud)", () => {
    async function settle(r: SplatRenderer): Promise<void> {
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      await vi.advanceTimersByTimeAsync(1000);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
    }

    it("thins a settled camera down to the settled budget instead of drawing everything", async () => {
      const { r } = make(2);
      r.setSettledBudget(3);
      await settle(r);
      expect(sortSpy).toHaveBeenCalledTimes(2);
      expect(tauOf(1)).toBeGreaterThan(0);
    });

    it("keeps full quality for a cloud that fits the settled budget", async () => {
      const { r } = make(2);
      r.setSettledBudget(10);
      await settle(r);
      expect(tauOf(1)).toBe(0);
    });

    it("keeps steering a still camera onto the settled budget from the measured count", async () => {
      const { r, wake } = make(2);
      r.setSettledBudget(3);
      await settle(r);
      wake.mockClear();
      await vi.advanceTimersByTimeAsync(0);
      expect(wake).toHaveBeenCalled();

      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      expect(sortSpy).toHaveBeenCalledTimes(3);
      expect(tauOf(2)).toBeGreaterThan(tauOf(1));
    });

    it("does not re-sort a settled view whose camera has moved on", async () => {
      const { r, wake } = make(2);
      r.setSettledBudget(3);
      await settle(r);
      now += 1000;
      at(r, 5);
      r.sortGpu({} as GPUCommandEncoder);
      wake.mockClear();
      await vi.advanceTimersByTimeAsync(0);

      now += 1000;
      at(r, 5);
      expect(r.sortGpu({} as GPUCommandEncoder)).toBe(true);
      expect(sortSpy).toHaveBeenCalledTimes(3);
    });

    it("applies to the full-quality sort that follows a released hold", () => {
      const { r } = make(2);
      r.setSettledBudget(3);
      r.setInteractiveHold(true);
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);

      r.setInteractiveHold(false);
      now += 1000;
      at(r, 0);
      r.sortGpu({} as GPUCommandEncoder);
      expect(sortSpy).toHaveBeenCalledTimes(2);
      expect(tauOf(1)).toBeGreaterThan(0);
    });
  });
});
