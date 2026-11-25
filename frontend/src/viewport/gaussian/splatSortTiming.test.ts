import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GpuSortTimer } from "./splatSortTiming";

function makeDevice(options: { timestamps?: boolean; ticks?: [bigint, bigint]; failMap?: boolean } = {}) {
  const queries = { destroyed: false };
  const readBuffer = {
    destroy: vi.fn(),
    mapAsync: vi.fn(async () => {
      if (options.failMap) throw new Error("lost");
    }),
    getMappedRange: () => new BigUint64Array(options.ticks ?? [0n, 0n]).buffer,
    unmap: vi.fn(),
  };
  const buffers: unknown[] = [];
  const device = {
    features: new Set(options.timestamps === false ? [] : ["timestamp-query"]),
    createQuerySet: vi.fn(() => ({ destroy: () => (queries.destroyed = true) })),
    createBuffer: vi.fn((desc: { usage: number }) => {
      const buffer = desc.usage & 1 /* MAP_READ */ ? readBuffer : { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
  } as unknown as GPUDevice;
  return { device, readBuffer, queries, buffers };
}

function fakeEncoder() {
  return { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() } as unknown as GPUCommandEncoder & {
    resolveQuerySet: ReturnType<typeof vi.fn>;
    copyBufferToBuffer: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", { QUERY_RESOLVE: 2, COPY_SRC: 4, COPY_DST: 8, MAP_READ: 1 });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GpuSortTimer", () => {
  it("should stay inert without timestamp-query support", () => {
    const { device } = makeDevice({ timestamps: false });
    const timer = new GpuSortTimer(device);

    expect(timer.begin()).toBeNull();
    expect(timer.ms).toBeNull();
    expect(device.createQuerySet).not.toHaveBeenCalled();
  });

  it("should stay inert on a device without feature information", () => {
    const timer = new GpuSortTimer({} as GPUDevice);

    expect(timer.begin()).toBeNull();
    expect(timer.ms).toBeNull();
  });

  it("should resolve the stamps and read the sort duration in milliseconds", async () => {
    const { device } = makeDevice({ ticks: [1_000_000n, 5_500_000n] });
    const timer = new GpuSortTimer(device);
    const encoder = fakeEncoder();

    const stamps = timer.begin();
    expect(stamps).not.toBeNull();
    timer.end(encoder, true);
    await vi.runAllTimersAsync();

    expect(encoder.resolveQuerySet).toHaveBeenCalledWith(stamps, 0, 2, expect.anything(), 0);
    expect(encoder.copyBufferToBuffer).toHaveBeenCalledTimes(1);
    expect(timer.ms).toBeCloseTo(4.5, 6);
  });

  it("should not stamp a new sort while the previous sample is still being read", async () => {
    const { device } = makeDevice({ ticks: [0n, 2_000_000n] });
    const timer = new GpuSortTimer(device);

    timer.begin();
    timer.end(fakeEncoder(), true);

    expect(timer.begin()).toBeNull();
    await vi.runAllTimersAsync();
    expect(timer.begin()).not.toBeNull();
  });

  it("should smooth successive samples", async () => {
    const first = makeDevice({ ticks: [0n, 10_000_000n] });
    const timer = new GpuSortTimer(first.device);
    timer.begin();
    timer.end(fakeEncoder(), true);
    await vi.runAllTimersAsync();
    expect(timer.ms).toBe(10);

    // A 20 ms sample moves the average by 30% of the difference.
    first.readBuffer.getMappedRange = () => new BigUint64Array([0n, 20_000_000n]).buffer;
    timer.begin();
    timer.end(fakeEncoder(), true);
    await vi.runAllTimersAsync();
    expect(timer.ms).toBeCloseTo(13, 6);
  });

  it("should ignore an empty read and keep the previous estimate when mapping fails", async () => {
    const { device } = makeDevice({ ticks: [0n, 0n] });
    const timer = new GpuSortTimer(device);
    timer.begin();
    timer.end(fakeEncoder(), true);
    await vi.runAllTimersAsync();
    expect(timer.ms).toBeNull();

    const failing = makeDevice({ failMap: true });
    const other = new GpuSortTimer(failing.device);
    other.begin();
    other.end(fakeEncoder(), true);
    await vi.runAllTimersAsync();
    expect(other.ms).toBeNull();
    expect(other.begin()).not.toBeNull();
  });

  it("should do nothing when the sort was not stamped", () => {
    const { device } = makeDevice();
    const timer = new GpuSortTimer(device);
    const encoder = fakeEncoder();

    timer.end(encoder, false);

    expect(encoder.resolveQuerySet).not.toHaveBeenCalled();
    expect(timer.begin()).not.toBeNull();
  });

  it("should release its GPU objects", () => {
    const { device, queries, buffers } = makeDevice();
    const timer = new GpuSortTimer(device);

    timer.dispose();

    expect(queries.destroyed).toBe(true);
    expect(buffers.length).toBe(2);
  });
});
