import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import { prepareSplatSlices } from '../viewport/gaussian/splatPrepare';
import { splatStrideForDegree } from '../viewport/gaussian/splatLayout';
import type { DecodedSog, LodMeta, SogChunkDecoder } from './sogLoader';
import type { ResidentSplatTarget } from './lodStreamer';

const STRIDE = splatStrideForDegree(0);
const COUNT = 500;

const lodMeta: LodMeta = {
  lodLevels: 2,
  filenames: ['a', 'b'],
  tree: {
    bound: { min: [10, 20, 30], max: [14, 22, 32] },
    children: [
      { bound: { min: [10, 20, 30], max: [12, 22, 32] }, lods: { '0': { file: 0, offset: 0, count: COUNT }, '1': { file: 1, offset: 0, count: COUNT } } },
      { bound: { min: [12, 20, 30], max: [14, 22, 32] }, lods: { '0': { file: 1, offset: 0, count: COUNT }, '1': { file: 1, offset: 0, count: COUNT } } },
    ],
  },
};

vi.mock('./sogLoader', async (importOriginal) => ({
  ...await importOriginal<typeof import('./sogLoader')>(),
  fetchLodMeta: vi.fn(async () => lodMeta),
  decodeSogDataset: vi.fn(),
  loadStreamedSog: vi.fn(),
}));

const { loadLodStreamedIntoRenderer, supportsLodStreaming } = await import('./sogRendererBridge');
const { applyShCap, fetchLodMeta } = await import('./sogLoader');

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

function fakeTarget(begin: SplatUploadStatus = status()) {
  const target: ResidentSplatTarget = {
    beginGaussianResidentStore: vi.fn(() => begin),
    gaussianResidentCapacityLimit: vi.fn(() => 1_000_000),
    writeGaussianResident: vi.fn(),
    releaseGaussianResident: vi.fn(),
    setGaussianResidentCount: vi.fn(),
    getCameraPose: vi.fn(() => [0, 0, 0, 1] as [number, number, number, number]),
    abortGaussianSplatUpload: vi.fn(),
    render: vi.fn(),
  };
  return target;
}

const decoder = vi.fn(async (): Promise<DecodedSog> => {
  const buffer = new Uint32Array(COUNT * STRIDE);
  return {
    buffer,
    prepared: prepareSplatSlices(buffer, 0),
    meta: {
      count: COUNT,
      sourceCount: COUNT,
      shDegree: 0,
      shStride: STRIDE,
      layoutVersion: 2,
      layoutName: 'x',
      origin: [0, 0, 0],
      min: [0, 0, 0],
      max: [1, 1, 1],
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  decoder.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('loadLodStreamedIntoRenderer', () => {
  it('should not decode when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const target = fakeTarget();
    const onFirstReady = vi.fn();
    const outcome = await loadLodStreamedIntoRenderer({} as never, target, 'https://h/lod-meta.json', {
      signal: controller.signal, onFirstReady,
    }, { decoder }).then(() => null, (error: unknown) => error);

    expect(outcome).toMatchObject({ name: 'AbortError' });
    expect(decoder).not.toHaveBeenCalled();
    expect(onFirstReady).not.toHaveBeenCalled();
    expect(target.beginGaussianResidentStore).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { unit: 1, signalAbort: true },
    { unit: 2, signalAbort: true },
    { unit: 1, signalAbort: false },
    { unit: 2, signalAbort: false },
  ])('should reject without readiness or polling when decode aborts: %j', async ({ unit, signalAbort }) => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const target = fakeTarget();
    const onFirstReady = vi.fn();
    let enter!: () => void;
    let resolve!: (value: DecodedSog) => void;
    let reject!: (error: Error) => void;
    const entered = new Promise<void>((done) => { enter = done; });
    const pending = new Promise<DecodedSog>((done, fail) => { resolve = done; reject = fail; });
    let calls = 0;
    const blocked = vi.fn<SogChunkDecoder>(async () => {
      if (++calls !== unit) return decoder();
      enter();
      return pending;
    });
    const outcome = loadLodStreamedIntoRenderer({} as never, target, 'https://h/lod-meta.json', {
      signal: controller.signal, onFirstReady, lodStreaming: { baseDistance: 100 },
    }, { decoder: blocked }).then(() => null, (error: unknown) => error);
    await entered;
    if (signalAbort) {
      controller.abort();
      resolve(await decoder());
    } else {
      reject(new DOMException('decoder stopped', 'AbortError'));
    }

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(onFirstReady).not.toHaveBeenCalled();
    expect(target.writeGaussianResident).toHaveBeenCalledTimes(unit - 1);
    expect(target.abortGaussianSplatUpload).toHaveBeenCalledTimes(unit - 1);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    const polls = vi.mocked(target.getCameraPose).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(target.getCameraPose).mock.calls.length).toBe(polls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { counts: [1001, 500], limit: 1000, sceneCount: 1001, degree: 0 },
    { counts: [1000, 500], limit: 1000, sceneCount: 1000, degree: 3 },
    { counts: undefined, limit: 999, sceneCount: 1000, degree: 0 },
    { counts: undefined, limit: 1000, sceneCount: 1000, degree: 3 },
  ])('should apply one LOD0 scene cap to every small chunk: %j', async ({ counts, limit, sceneCount, degree }) => {
    vi.mocked(fetchLodMeta).mockResolvedValueOnce({ ...lodMeta, count: 10_000, counts });
    const cappedDecoder = vi.fn<SogChunkDecoder>(async (_url, _origin, cap) => {
      const source = JSON.parse(applyShCap(JSON.stringify({ count: COUNT, shN: {} }), cap)) as { shN?: unknown };
      const shDegree = source.shN === undefined ? 0 : 3;
      const buffer = new Uint32Array(COUNT * splatStrideForDegree(shDegree));
      const decoded = await decoder();
      return {
        buffer,
        prepared: prepareSplatSlices(buffer, shDegree),
        meta: { ...decoded.meta, shDegree, shStride: splatStrideForDegree(shDegree) },
      };
    });
    const target = fakeTarget();
    const info = await loadLodStreamedIntoRenderer({} as never, target, 'https://h/lod-meta.json', {
      shMaxSplats: limit,
      lodStreaming: { baseDistance: 100 },
    }, { decoder: cappedDecoder });
    info.lodStream!.dispose();

    expect(cappedDecoder).toHaveBeenCalledTimes(2);
    expect(cappedDecoder.mock.calls.map((call) => call[2])).toEqual([
      { dropShAbove: limit, sceneCount },
      { dropShAbove: limit, sceneCount },
    ]);
    expect(info.shDegree).toBe(degree);
    expect(target.beginGaussianResidentStore).toHaveBeenCalledWith(
      expect.any(Number), degree, 2, expect.any(Object), undefined,
    );
  });

  it.each([undefined, 0, -1])('should leave the LOD SH cap disabled for shMaxSplats=%s', async (shMaxSplats) => {
    const uncappedDecoder = vi.fn<SogChunkDecoder>(async () => decoder());
    const info = await loadLodStreamedIntoRenderer({} as never, fakeTarget(), 'https://h/lod-meta.json', {
      shMaxSplats,
      lodStreaming: { baseDistance: 100 },
    }, { decoder: uncappedDecoder });
    info.lodStream!.dispose();

    expect(uncappedDecoder).toHaveBeenCalledTimes(2);
    expect(uncappedDecoder.mock.calls.every((call) => call[2] === undefined)).toBe(true);
  });

  it('should resolve with the first view and a handle, decoding around the scene centre', async () => {
    const target = fakeTarget();
    const onFirstReady = vi.fn();

    const info = await loadLodStreamedIntoRenderer({} as never, target, 'https://h/lod-meta.json', { lodStreaming: true, onFirstReady }, { decoder });

    expect(info.origin).toEqual([12, 21, 31]);
    expect(info.uploadStatus.outcome).toBe('uploaded');
    expect(info.count).toBeGreaterThan(0);
    expect(info.lodStream).toBeDefined();
    expect(onFirstReady).toHaveBeenCalledTimes(1);
    expect(decoder.mock.calls.length).toBeGreaterThan(0);
    expect(decoder.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(['https://h/b']));
    for (const call of decoder.mock.calls) expect(call[1]).toEqual([12, 21, 31]);
    info.lodStream!.dispose();
  });

  it('should keep the file frame when world aligned and honour an explicit origin first', async () => {
    const aligned = await loadLodStreamedIntoRenderer({} as never, fakeTarget(), 'https://h/lod-meta.json', { worldAligned: true, lodStreaming: true }, { decoder });
    expect(aligned.origin).toEqual([0, 0, 0]);
    aligned.lodStream!.dispose();

    const explicit = await loadLodStreamedIntoRenderer({} as never, fakeTarget(), 'https://h/lod-meta.json', { worldAligned: true, origin: [1, 2, 3] }, { decoder });
    expect(explicit.origin).toEqual([1, 2, 3]);
    explicit.lodStream!.dispose();
  });

  it('should use tuning options for the budget', async () => {
    const info = await loadLodStreamedIntoRenderer({} as never, fakeTarget(), 'https://h/lod-meta.json', { lodStreaming: { budget: 600 } }, { decoder });

    expect(info.lodStream!.stats().budget).toBeLessThanOrEqual(600);
    info.lodStream!.dispose();
  });

  it('should return a failed status and release the store when the renderer cannot hold it', async () => {
    const failed = status({ outcome: 'failed', fallbackReason: 'texture-array-capacity-exceeded' });
    const target = fakeTarget(failed);

    const info = await loadLodStreamedIntoRenderer({} as never, target, 'https://h/lod-meta.json', { lodStreaming: true }, { decoder });

    expect(info.uploadStatus).toBe(failed);
    expect(info.count).toBe(0);
    expect(info.lodStream).toBeUndefined();
    expect(target.abortGaussianSplatUpload).toHaveBeenCalled();
  });

  it('should rethrow a decode failure of the first view', async () => {
    const broken = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      loadLodStreamedIntoRenderer({} as never, fakeTarget(), 'https://h/lod-meta.json', { lodStreaming: true }, { decoder: broken }),
    ).rejects.toThrow('boom');
  });
});

describe('supportsLodStreaming', () => {
  it('should accept a scene with coarser LOD levels', async () => {
    expect(await supportsLodStreaming('https://h/lod-meta.json')).toBe(true);
  });

  it('should reject a single-level scene, which a budget could only show partially', async () => {
    vi.mocked(fetchLodMeta).mockResolvedValueOnce({ ...lodMeta, lodLevels: 1 });
    expect(await supportsLodStreaming('https://h/lod-meta.json')).toBe(false);
  });
});
