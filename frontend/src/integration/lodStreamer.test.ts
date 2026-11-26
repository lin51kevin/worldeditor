import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import { prepareSplatSlices, type PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import { splatStrideForDegree } from '../viewport/gaussian/splatLayout';
import { LodStoreFailure, LodStreamer, type LodStreamingOptions, type ResidentSplatTarget } from './lodStreamer';
import * as sogLoader from './sogLoader';
import type { DecodedSog, LodMeta, LodNode, SogSplatMeta, SogWasm } from './sogLoader';

const UNIT_SPLATS = 1000;
const STRIDE = splatStrideForDegree(0);

/** Four unit cubes along x. LOD0: one file each (a-d); LOD1: e (leaves 0,1), f (2,3); LOD2: g (all). */
function sceneMeta(): LodMeta {
  const leaf = (i: number): LodNode => ({
    bound: { min: [i, 0, 0], max: [i + 1, 1, 1] },
    lods: {
      '0': { file: i, offset: 0, count: 500 },
      '1': { file: i < 2 ? 4 : 5, offset: (i % 2) * 250, count: 250 },
      '2': { file: 6, offset: i * 125, count: 125 },
    },
  });
  // Files hold UNIT_SPLATS each: scale the per-leaf counts so every file totals that.
  const scale = (node: LodNode): LodNode => {
    if (node.lods) {
      for (const run of Object.values(node.lods)) {
        const leavesInFile = run.file < 4 ? 1 : run.file < 6 ? 2 : 4;
        run.count = UNIT_SPLATS / leavesInFile;
      }
    }
    node.children?.forEach(scale);
    return node;
  };
  return {
    lodLevels: 3,
    filenames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    tree: scale({
      bound: { min: [0, 0, 0], max: [4, 1, 1] },
      children: [
        { bound: { min: [0, 0, 0], max: [2, 1, 1] }, children: [leaf(0), leaf(1)] },
        { bound: { min: [2, 0, 0], max: [4, 1, 1] }, children: [leaf(2), leaf(3)] },
      ],
    }),
  };
}

const status = (overrides: Partial<SplatUploadStatus> = {}): SplatUploadStatus => ({
  outcome: 'uploaded',
  sourceCount: 0,
  uploadedCount: 0,
  requestedShDegree: 0,
  effectiveShDegree: 0,
  renderMode: 'full',
  resourceMode: 'texture-array',
  fallbackReason: null,
  ...overrides,
});

function fakeTarget(options: { limit?: number; begin?: SplatUploadStatus } = {}) {
  const pose: [number, number, number, number] = [0.5, 0.5, 0.5, 1];
  const writes: Array<{ first: number; count: number }> = [];
  const releases: Array<{ first: number; count: number }> = [];
  const target: ResidentSplatTarget = {
    beginGaussianResidentStore: vi.fn(() => options.begin ?? status()),
    gaussianResidentCapacityLimit: vi.fn(() => options.limit ?? 10_000_000),
    writeGaussianResident: vi.fn((prepared: PreparedSplatChunk, first: number) => {
      writes.push({ first, count: prepared.count });
    }),
    releaseGaussianResident: vi.fn((first: number, count: number) => {
      releases.push({ first, count });
    }),
    setGaussianResidentCount: vi.fn(),
    getCameraPose: vi.fn(() => [...pose] as [number, number, number, number]),
    abortGaussianSplatUpload: vi.fn(),
    render: vi.fn(),
  };
  return { target, pose, writes, releases };
}

const unitMeta = (): SogSplatMeta => ({
  count: UNIT_SPLATS,
  sourceCount: UNIT_SPLATS,
  shDegree: 0,
  shStride: STRIDE,
  layoutVersion: 2,
  layoutName: 'transform-f32-opacity-sh-f16',
  origin: [0, 0, 0],
  min: [0, 0, 0],
  max: [1, 1, 1],
});

function fakeDecoder(failFor: Set<string> = new Set()) {
  const requested: string[] = [];
  const decoder = vi.fn(async (url: string): Promise<DecodedSog> => {
    const name = url.split('/').pop()!;
    requested.push(name);
    if (failFor.has(name)) throw new Error(`boom ${name}`);
    const buffer = new Uint32Array(UNIT_SPLATS * STRIDE);
    return { buffer, meta: unitMeta(), prepared: prepareSplatSlices(buffer, 0) };
  });
  return { decoder, requested };
}

function makeStreamer(
  target: ResidentSplatTarget,
  decoder: (url: string, origin: readonly number[] | undefined) => Promise<DecodedSog>,
  options: LodStreamingOptions = {},
  origin: [number, number, number] = [0, 0, 0],
  signal?: AbortSignal,
) {
  return new LodStreamer({
    wasm: {} as SogWasm,
    target,
    lodMetaUrl: 'https://h/s/lod-meta.json',
    meta: sceneMeta(),
    origin,
    signal,
    decoder,
    options: { budget: 1_000_000, baseDistance: 1, evictAfterMs: 1000, updateIntervalMs: 100, ...options },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LodStreamer start', () => {
  it('should clean an aborted partial store before the next load and ignore late old decodes', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    let reject!: (error: Error) => void;
    let resolve!: (value: DecodedSog) => void;
    let enter!: () => void;
    const entered = new Promise<void>((done) => { enter = done; });
    const aborted = new Promise<DecodedSog>((_done, fail) => { reject = fail; });
    const late = new Promise<DecodedSog>((done) => { resolve = done; });
    const oldDecoder = vi.fn(decoder)
      .mockImplementationOnce(() => decoder('https://h/a'))
      .mockImplementationOnce(() => aborted)
      .mockImplementationOnce(() => { enter(); return late; });
    const outcome = makeStreamer(target, oldDecoder).start().then(() => null, (error: unknown) => error);
    await entered;
    reject(new DOMException('decoder stopped', 'AbortError'));
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(target.abortGaussianSplatUpload).toHaveBeenCalledTimes(1);

    const next = await makeStreamer(target, decoder).start();
    const writes = vi.mocked(target.writeGaussianResident).mock.calls.length;
    resolve(await decoder('https://h/c'));
    await vi.advanceTimersByTimeAsync(500);
    expect(target.writeGaussianResident).toHaveBeenCalledTimes(writes);
    expect(target.abortGaussianSplatUpload).toHaveBeenCalledTimes(1);
    expect(next.handle.stats().residentUnits).toBe(4);
    next.handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should forward the same scene SH cap to every worker decode, including later views', async () => {
    const { target, pose } = fakeTarget();
    pose.splice(0, 3, -0.5, -1.5, -2.5);
    const { decoder } = fakeDecoder();
    const workerDecoder = vi.fn<sogLoader.SogChunkDecoder>((url) => decoder(url));
    const shCap = { dropShAbove: 3000, sceneCount: 4000 };
    const result = await new LodStreamer({
      wasm: {} as SogWasm,
      target,
      lodMetaUrl: 'https://h/s/lod-meta.json',
      meta: sceneMeta(),
      origin: [1, 2, 3],
      shCap,
      decoder: workerDecoder,
      options: { budget: 1_000_000, baseDistance: 1, updateIntervalMs: 100 },
    }).start();
    const firstViewCalls = workerDecoder.mock.calls.length;
    pose[0] = 2.5;
    await vi.advanceTimersByTimeAsync(150);
    result.handle.dispose();

    expect(workerDecoder.mock.calls.length).toBeGreaterThan(firstViewCalls);
    for (const call of workerDecoder.mock.calls) {
      expect(call[1]).toEqual([1, 2, 3]);
      expect(call[2]).toEqual(shCap);
    }
  });

  it('should forward the scene SH cap, origin and signal to every local decode', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const localDecode = vi.spyOn(sogLoader, 'decodeSogDataset').mockImplementation((wasm, url) => decoder(url));
    const wasm = {} as SogWasm;
    const signal = new AbortController().signal;
    const shCap = { dropShAbove: 3000, sceneCount: 4000 };
    try {
      const result = await new LodStreamer({
        wasm,
        target,
        lodMetaUrl: 'https://h/s/lod-meta.json',
        meta: sceneMeta(),
        origin: [0, 0, 0],
        signal,
        shCap,
        options: { budget: 1_000_000, baseDistance: 1 },
      }).start();
      result.handle.dispose();

      expect(localDecode).toHaveBeenCalledTimes(4);
      for (const call of localDecode.mock.calls) {
        expect(call).toEqual([wasm, expect.any(String), { signal, origin: [0, 0, 0], shCap }]);
      }
    } finally {
      localDecode.mockRestore();
    }
  });

  it('should bring the units the first view needs resident and report the scene', async () => {
    const { target, writes } = fakeTarget();
    const { decoder, requested } = fakeDecoder();
    const streamer = makeStreamer(target, decoder);

    const result = await streamer.start();

    // Camera in leaf 0: LOD 0 for leaves 0-2, LOD 1 (file f) for leaf 3.
    expect([...requested].sort()).toEqual(['a', 'b', 'c', 'f']);
    expect(result.residentSplats).toBe(4 * UNIT_SPLATS);
    expect(result.shDegree).toBe(0);
    expect(result).toMatchObject({ layoutVersion: 2, min: [0, 0, 0], max: [4, 1, 1], origin: [0, 0, 0] });
    expect(writes.reduce((sum, w) => sum + w.count, 0)).toBe(4 * UNIT_SPLATS);
    expect(target.beginGaussianResidentStore).toHaveBeenCalledTimes(1);
    expect(result.handle.stats()).toMatchObject({ residentUnits: 4, loadingUnits: 0, wantedUnits: 4, failedUnits: 0 });
    result.handle.dispose();
  });

  it('should size the store from the budget with headroom, within the device limit', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();

    const result = await makeStreamer(target, decoder, { budget: 100_000 }).start();

    expect(result.capacity).toBe(125_000);
    expect((target.beginGaussianResidentStore as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(125_000);
    result.handle.dispose();

    const limited = fakeTarget({ limit: 6000 });
    const small = await makeStreamer(limited.target, decoder, { budget: 100_000 }).start();
    expect(small.capacity).toBe(6000);
    expect(small.handle.stats().budget).toBe(4800);
    small.handle.dispose();
  });

  it('should write each unit into slots starting after the previous one', async () => {
    const { target, writes } = fakeTarget();
    const { decoder } = fakeDecoder();

    const result = await makeStreamer(target, decoder).start();

    const firsts = writes.map((w) => w.first).sort((a, b) => a - b);
    expect(firsts).toEqual([0, 1000, 2000, 3000]);
    result.handle.dispose();
  });

  it('should reject when the renderer cannot allocate the store', async () => {
    const { target } = fakeTarget({ begin: status({ outcome: 'failed', fallbackReason: 'texture-array-capacity-exceeded' }) });
    const { decoder } = fakeDecoder();

    await expect(makeStreamer(target, decoder).start()).rejects.toBeInstanceOf(LodStoreFailure);
    expect(target.writeGaussianResident).not.toHaveBeenCalled();
  });

  it('should reject when a single unit is larger than anything the device can hold', async () => {
    const { target } = fakeTarget({ limit: 10 });
    const { decoder } = fakeDecoder();

    await expect(makeStreamer(target, decoder).start()).rejects.toBeInstanceOf(LodStoreFailure);
    expect(target.beginGaussianResidentStore).not.toHaveBeenCalled();
  });

  it('should propagate a failure to decode the first unit', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder(new Set(['a', 'b', 'c', 'f']));

    await expect(makeStreamer(target, decoder).start()).rejects.toThrow(/boom/);
  });

  it('should decode into the frame given by the origin and place leaf bounds in it', async () => {
    const { target, pose } = fakeTarget();
    pose.splice(0, 3, 0, 0, 0);
    const { decoder } = fakeDecoder();

    const result = await makeStreamer(target, decoder, {}, [1.5, 0.5, 0.5]).start();

    expect(decoder.mock.calls[0]![1]).toEqual([1.5, 0.5, 0.5]);
    expect(result.min).toEqual([-1.5, -0.5, -0.5]);
    expect(result.max).toEqual([2.5, 0.5, 0.5]);
    result.handle.dispose();
  });
});

describe('LodStreamer following the camera', () => {
  it.each([true, false])('should stop a running stream on terminal abort (signal: %s)', async (signalAbort) => {
    const { target, pose } = fakeTarget();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const { decoder } = fakeDecoder();
    const streamDecoder = vi.fn(decoder);
    const result = await makeStreamer(target, streamDecoder, { maxConcurrentLoads: 1 }, [0, 0, 0], controller.signal).start();
    let resolve!: (value: DecodedSog) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<DecodedSog>((done, fail) => { resolve = done; reject = fail; });
    streamDecoder.mockImplementationOnce(() => pending);
    pose[0] = 3.5;
    await vi.advanceTimersByTimeAsync(100);
    expect(result.handle.stats().loadingUnits).toBe(1);
    const writes = vi.mocked(target.writeGaussianResident).mock.calls.length;
    const calls = streamDecoder.mock.calls.length;
    if (signalAbort) {
      controller.abort();
      resolve(await decoder('https://h/d'));
    } else {
      reject(new DOMException('decoder stopped', 'AbortError'));
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await result.handle.whenIdle();
    expect(streamDecoder).toHaveBeenCalledTimes(calls);
    expect(target.writeGaussianResident).toHaveBeenCalledTimes(writes);
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(target.abortGaussianSplatUpload).not.toHaveBeenCalled();
    result.handle.dispose();
  });

  it('should remove the signal listener on normal disposal', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await makeStreamer(target, decoder, {}, [0, 0, 0], controller.signal).start();
    result.handle.dispose();
    expect(added).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should load the units of a new view and release the old ones after the grace period', async () => {
    const { target, pose, releases } = fakeTarget();
    const { decoder, requested } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();
    requested.length = 0;

    pose[0] = 3.5;
    await vi.advanceTimersByTimeAsync(150);

    // Camera in leaf 3: LOD 0 for leaves 1-3 (b, c, d), LOD 1 (file e) for leaf 0. Only d and e are new.
    expect(requested.sort()).toEqual(['d', 'e']);
    expect(releases).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1500);

    expect(result.handle.stats().residentSplats).toBe(result.handle.stats().wantedUnits * UNIT_SPLATS);
    // Unneeded a and f are released: one range each.
    expect(releases).toHaveLength(2);
    result.handle.dispose();
  });

  it('should not release a unit that is still wanted', async () => {
    const { target, releases } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(releases).toHaveLength(0);
    expect(result.handle.stats().residentUnits).toBe(4);
    result.handle.dispose();
  });

  it('should reuse released slots for later units', async () => {
    const { target, pose, writes } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder, { budget: 4000 }).start();
    const capacity = result.capacity;

    pose[0] = 3.5;
    await vi.advanceTimersByTimeAsync(3000);
    pose[0] = 0.5;
    await vi.advanceTimersByTimeAsync(3000);

    expect(writes.every((w) => w.first + w.count <= capacity)).toBe(true);
    result.handle.dispose();
  });

  it('should free room under pressure by releasing unwanted units before their grace period ends', async () => {
    const { target, pose, releases } = fakeTarget();
    const { decoder } = fakeDecoder();
    // Capacity 5000 (budget 4000 x 1.25) holds one view; the next view must evict the old one.
    const result = await makeStreamer(target, decoder, { budget: 4000, evictAfterMs: 60_000 }).start();

    pose[0] = 3.5;
    await vi.advanceTimersByTimeAsync(400);

    expect(releases.length).toBeGreaterThan(0);
    expect(result.handle.stats().residentSplats).toBeLessThanOrEqual(result.capacity);
    result.handle.dispose();
  });

  it('should retry a unit that failed to load after a pause and keep loading the others', async () => {
    const { target } = fakeTarget();
    const failing = new Set(['c']);
    const { decoder, requested } = fakeDecoder(failing);
    const result = await makeStreamer(target, decoder).start();

    expect(result.handle.stats()).toMatchObject({ residentUnits: 3, failedUnits: 1 });

    failing.clear();
    requested.length = 0;
    await vi.advanceTimersByTimeAsync(6000);

    expect(requested).toContain('c');
    expect(result.handle.stats()).toMatchObject({ residentUnits: 4, failedUnits: 0 });
    result.handle.dispose();
  });

  it('should coarsen the view when the budget is lowered', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();
    const before = result.handle.stats().wantedUnits;

    result.handle.setBudget(2000);
    await vi.advanceTimersByTimeAsync(300);

    const after = result.handle.stats();
    expect(after.budget).toBe(2000);
    expect(after.wantedUnits).toBeLessThan(before);
    expect(after.bias).toBeGreaterThan(0);
    result.handle.dispose();
  });

  it('should resolve whenIdle immediately when nothing is queued', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();

    await expect(result.handle.whenIdle()).resolves.toBeUndefined();
    result.handle.dispose();
  });

  it('should ask for a frame when slots change, at most every 250 ms', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();
    await vi.advanceTimersByTimeAsync(300);

    const rendered = (target.render as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(rendered).toBeGreaterThanOrEqual(1);
    // Four units landed in one tick: far fewer frames than writes.
    expect(rendered).toBeLessThanOrEqual(3);
    result.handle.dispose();
  });

  it('should stop sampling the camera after dispose', async () => {
    const { target } = fakeTarget();
    const { decoder } = fakeDecoder();
    const result = await makeStreamer(target, decoder).start();
    const polls = (target.getCameraPose as ReturnType<typeof vi.fn>).mock.calls.length;

    result.handle.dispose();
    await vi.advanceTimersByTimeAsync(2000);

    expect((target.getCameraPose as ReturnType<typeof vi.fn>).mock.calls.length).toBe(polls);
  });
});
