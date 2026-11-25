import { describe, expect, it, vi } from "vitest";
import { SplatRenderer } from "./splatRenderer";
import { splatStrideForDegree } from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";
import type { SplatSorter } from "./splatSortController";

const STRIDE1 = splatStrideForDegree(1);

function fakeDevice(options: { compute?: boolean; limits?: Partial<GPUSupportedLimits> } = {}) {
  const textures: Array<{ destroyed: boolean }> = [];
  const device = {
    createBuffer: () => ({ destroy() {} }),
    createTexture: () => {
      const texture = {
        destroyed: false,
        createView: () => ({}),
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
    createBindGroup: () => ({}),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
    limits: {
      maxTextureDimension2D: 64,
      maxTextureArrayLayers: 256,
      maxBufferSize: 1_073_741_824,
      maxStorageBufferBindingSize: 1_073_741_824,
      ...options.limits,
    },
    ...(options.compute ? { createComputePipeline: vi.fn() } : {}),
  } as unknown as GPUDevice;
  return { device, textures };
}

function recordingSorter() {
  const inits: Float32Array[] = [];
  const sorter: SplatSorter = {
    init(positions) {
      inits.push(positions);
    },
    sort() {},
    dispose() {},
  };
  return { sorter, inits };
}

function makeRenderer(device: GPUDevice) {
  const { sorter, inits } = recordingSorter();
  const renderer = new SplatRenderer(device, {} as GPUBindGroupLayout, {} as GPURenderPipeline, sorter);
  return { renderer, inits };
}

/** `count` degree-1 records whose position is (i, i + 0.5, -i). */
function splats(count: number, first = 0): Uint32Array {
  const data = new Uint32Array(count * STRIDE1);
  const f32 = new Float32Array(data.buffer);
  for (let i = 0; i < count; i++) {
    f32[i * STRIDE1] = first + i;
    f32[i * STRIDE1 + 1] = first + i + 0.5;
    f32[i * STRIDE1 + 2] = -(first + i);
  }
  return data;
}

const bounds = { min: [0, 0, -9] as const, max: [9, 9.5, 0] as const };

describe("SplatRenderer chunked upload", () => {
  it("should upload chunks and report a full-fidelity upload", () => {
    const { device } = fakeDevice();
    const { renderer } = makeRenderer(device);

    const pending = renderer.beginUpload(10, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    expect(pending.outcome).toBe("empty");
    expect(renderer.uploading).toBe(true);
    expect(renderer.hasContent).toBe(false);

    expect(renderer.appendUpload(splats(4))).toBe(true);
    expect(renderer.appendUpload(splats(6, 4))).toBe(true);
    const status = renderer.endUpload(bounds);

    expect(status).toMatchObject({
      outcome: "uploaded",
      sourceCount: 10,
      uploadedCount: 10,
      effectiveShDegree: 1,
      renderMode: "full",
      resourceMode: "texture-array",
      fallbackReason: null,
    });
    expect(renderer.hasContent).toBe(true);
    expect(renderer.count).toBe(10);
    expect(renderer.uploading).toBe(false);
    expect(renderer.uploadStatus).toEqual(status);
  });

  it("should hand the sorter the positions of every chunk in order", () => {
    const { device } = fakeDevice();
    const { renderer, inits } = makeRenderer(device);
    renderer.beginUpload(5, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.appendUpload(splats(2));
    renderer.appendUpload(splats(3, 2));

    renderer.endUpload(bounds);

    const positions = inits[inits.length - 1]!;
    expect(Array.from(positions)).toEqual([0, 0.5, -0, 1, 1.5, -1, 2, 2.5, -2, 3, 3.5, -3, 4, 4.5, -4]);
  });

  it("should fail when the cloud exceeds the texture capacity and allow no append", () => {
    const { device } = fakeDevice({ limits: { maxTextureDimension2D: 4 } });
    const { renderer } = makeRenderer(device);

    const status = renderer.beginUpload(5000, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(status).toMatchObject({ outcome: "failed", fallbackReason: "texture-array-capacity-exceeded" });
    expect(renderer.uploading).toBe(false);
    expect(() => renderer.appendUpload(splats(1))).toThrow(/in progress/);
  });

  it("should fail when the order buffer cannot address the cloud", () => {
    const { device } = fakeDevice({ limits: { maxBufferSize: 16, maxStorageBufferBindingSize: 16 } });
    const { renderer } = makeRenderer(device);

    expect(renderer.beginUpload(100, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION)).toMatchObject({
      outcome: "failed",
      fallbackReason: "order-buffer-capacity-exceeded",
    });
  });

  it("should require GPU compute for clouds above the CPU sort limit", () => {
    const { device } = fakeDevice({ compute: false });
    const { renderer } = makeRenderer(device);
    renderer.cpuSortMaxSplats = 4;

    expect(renderer.beginUpload(10, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION)).toMatchObject({
      outcome: "failed",
      fallbackReason: "gpu-sort-unavailable",
    });
  });

  it("should keep no CPU positions and force the GPU sort for huge clouds", () => {
    const { device } = fakeDevice({ compute: true });
    const { renderer, inits } = makeRenderer(device);
    renderer.cpuSortMaxSplats = 4;
    renderer.beginUpload(6, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.appendUpload(splats(6));

    renderer.endUpload(bounds);

    expect(inits[inits.length - 1]!.length).toBe(0);
    expect((renderer as unknown as { useGpuSort: boolean }).useGpuSort).toBe(true);
    renderer.setGpuSort(false);
    expect((renderer as unknown as { useGpuSort: boolean }).useGpuSort).toBe(true);
  });

  it("should let the GPU sort be disabled again after a regular upload replaces a forced cloud", () => {
    const { device } = fakeDevice({ compute: true });
    const { renderer } = makeRenderer(device);
    renderer.cpuSortMaxSplats = 4;
    renderer.beginUpload(6, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.appendUpload(splats(6));
    renderer.endUpload(bounds);

    renderer.upload(splats(2), 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.setGpuSort(false);

    expect((renderer as unknown as { useGpuSort: boolean }).useGpuSort).toBe(false);
  });

  it("should fail the upload and return false when a chunk overflows the declared count", () => {
    const { device } = fakeDevice();
    const { renderer } = makeRenderer(device);
    renderer.beginUpload(2, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    const ok = renderer.appendUpload(splats(3));

    expect(ok).toBe(false);
    expect(renderer.uploadStatus.outcome).toBe("failed");
    expect(renderer.uploading).toBe(false);
    expect(renderer.hasContent).toBe(false);
  });

  it("should fail ending an incomplete upload", () => {
    const { device } = fakeDevice();
    const { renderer } = makeRenderer(device);
    renderer.beginUpload(4, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.appendUpload(splats(1));

    expect(renderer.endUpload(bounds).outcome).toBe("failed");
    expect(renderer.hasContent).toBe(false);
  });

  it("should free GPU memory when aborted and when cleared mid-upload", () => {
    const { device, textures } = fakeDevice();
    const { renderer } = makeRenderer(device);

    renderer.beginUpload(4, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.abortUpload();
    expect(renderer.uploading).toBe(false);
    expect(textures.every((t) => t.destroyed)).toBe(true);

    renderer.beginUpload(4, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    renderer.clear();
    expect(renderer.uploading).toBe(false);
    expect(renderer.uploadStatus.outcome).toBe("empty");
  });

  it("should abort a chunked upload when a regular upload starts", () => {
    const { device } = fakeDevice();
    const { renderer } = makeRenderer(device);
    renderer.beginUpload(4, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    renderer.upload(splats(2), 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(renderer.uploading).toBe(false);
    expect(renderer.count).toBe(2);
  });

  it("should replace a previous cloud when a new chunked upload begins", () => {
    const { device } = fakeDevice();
    const { renderer } = makeRenderer(device);
    renderer.upload(splats(2), 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    renderer.beginUpload(3, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(renderer.hasContent).toBe(false);
  });
});
