import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import { prepareSplatSlices } from '../viewport/gaussian/splatPrepare';
import { splatStrideForDegree } from '../viewport/gaussian/splatLayout';
import type { DecodedSog, LodMeta } from './sogLoader';
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

vi.mock('./sogLoader', () => ({
  fetchLodMeta: vi.fn(async () => lodMeta),
  decodeSogDataset: vi.fn(),
  loadStreamedSog: vi.fn(),
}));

const { loadLodStreamedIntoRenderer, supportsLodStreaming } = await import('./sogRendererBridge');
const { fetchLodMeta } = await import('./sogLoader');

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
