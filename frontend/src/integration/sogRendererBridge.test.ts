import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import type { SogSplatMeta, SogWasm, SplatChunkSink } from './sogLoader';

const decodeSogDataset = vi.fn();
const loadStreamedSog = vi.fn();
vi.mock('./sogLoader', () => ({
  decodeSogDataset: (...args: unknown[]) => decodeSogDataset(...args),
  loadStreamedSog: (...args: unknown[]) => loadStreamedSog(...args),
}));

import type { PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
const { loadSogIntoRenderer, loadStreamedSogIntoRenderer, SOG_UPLOAD_SLICE_SPLATS } = await import('./sogRendererBridge');
type Target = import('./sogRendererBridge').ChunkedSplatTarget;

const wasm = {} as SogWasm;
const STRIDE = 17;

const status = (overrides: Partial<SplatUploadStatus> = {}): SplatUploadStatus => ({
  outcome: 'uploaded',
  sourceCount: 0,
  uploadedCount: 0,
  requestedShDegree: 1,
  effectiveShDegree: 1,
  renderMode: 'full',
  resourceMode: 'texture-array',
  fallbackReason: null,
  ...overrides,
});

const meta = (count: number, overrides: Partial<SogSplatMeta> = {}): SogSplatMeta => ({
  count,
  sourceCount: count,
  shDegree: 1,
  shStride: STRIDE,
  layoutVersion: 2,
  layoutName: 'transform-f32-opacity-sh-f16',
  origin: [1, 2, 3],
  min: [-1, -2, -3],
  max: [4, 5, 6],
  ...overrides,
});

function makeTarget(overrides: Partial<Target> = {}) {
  const appended: number[] = [];
  const target: Target = {
    beginGaussianSplatUpload: vi.fn(() => status({ outcome: 'empty' })),
    appendGaussianSplats: vi.fn((chunk: Uint32Array) => {
      appended.push(chunk.length / STRIDE);
      return true;
    }),
    endGaussianSplatUpload: vi.fn(() => status({ uploadedCount: 7 })),
    abortGaussianSplatUpload: vi.fn(),
    getGaussianSplatUploadStatus: vi.fn(() => status({ outcome: 'failed', fallbackReason: 'texture-upload-failed' })),
    render: vi.fn(),
    ...overrides,
  };
  return { target, appended };
}

beforeEach(() => {
  decodeSogDataset.mockReset();
  loadStreamedSog.mockReset();
});

describe('loadSogIntoRenderer', () => {
  it('should upload the decoded buffer in slices and report the cloud info', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS * 2 + 10;
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(count * STRIDE), meta: meta(count) });
    const { target, appended } = makeTarget();

    const info = await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(count, 1, 2, undefined, undefined, false);
    expect(appended).toEqual([SOG_UPLOAD_SLICE_SPLATS, SOG_UPLOAD_SLICE_SPLATS, 10]);
    expect(target.endGaussianSplatUpload).toHaveBeenCalledWith({ min: [-1, -2, -3], max: [4, 5, 6] });
    expect(target.render).toHaveBeenCalledTimes(1);
    expect(info).toMatchObject({ count, origin: [1, 2, 3], shDegree: 1, layoutVersion: 2 });
    expect(info.uploadStatus.outcome).toBe('uploaded');
  });

  it('should pass the SOG training model to the renderer', async () => {
    decodeSogDataset.mockResolvedValue({
      buffer: new Uint32Array(STRIDE),
      meta: meta(1, { splatModel: 'antialiased' }),
    });
    const { target } = makeTarget();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(1, 1, 2, undefined, 'antialiased', false);
  });

  it('should decode with a zero origin when world aligned and forward the abort signal', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = makeTarget();
    const controller = new AbortController();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { worldAligned: true, signal: controller.signal });

    expect(decodeSogDataset).toHaveBeenCalledWith(wasm, 'https://h/meta.json', {
      signal: controller.signal,
      origin: [0, 0, 0],
    });
  });

  it('should prefer an explicit origin over world alignment', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = makeTarget();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { worldAligned: true, origin: [5, 6, 7] });

    expect(decodeSogDataset.mock.calls[0]![2]).toMatchObject({ origin: [5, 6, 7] });
  });

  it('should return the failed status without uploading when the device cannot hold the cloud', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const failed = status({ outcome: 'failed', fallbackReason: 'texture-array-capacity-exceeded' });
    const { target } = makeTarget({ beginGaussianSplatUpload: vi.fn(() => failed) });

    const info = await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(info.uploadStatus).toBe(failed);
    expect(target.appendGaussianSplats).not.toHaveBeenCalled();
    expect(target.render).not.toHaveBeenCalled();
  });

  it('should report the renderer failure when an append is rejected', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = makeTarget({ appendGaussianSplats: vi.fn(() => false) });

    const info = await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(info.uploadStatus.fallbackReason).toBe('texture-upload-failed');
    expect(target.endGaussianSplatUpload).not.toHaveBeenCalled();
  });

  it('should abort the upload and rethrow when appending throws', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = makeTarget({
      appendGaussianSplats: vi.fn(() => {
        throw new Error('boom');
      }),
    });

    await expect(loadSogIntoRenderer(wasm, target, 'https://h/meta.json')).rejects.toThrow('boom');
    expect(target.abortGaussianSplatUpload).toHaveBeenCalled();
  });

  it('should not touch the renderer when decoding fails', async () => {
    decodeSogDataset.mockRejectedValue(new Error('404'));
    const { target } = makeTarget();

    await expect(loadSogIntoRenderer(wasm, target, 'https://h/meta.json')).rejects.toThrow('404');
    expect(target.beginGaussianSplatUpload).not.toHaveBeenCalled();
    expect(target.abortGaussianSplatUpload).not.toHaveBeenCalled();
  });

  it('should reject a buffer that does not match its metadata', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(5) });
    const { target } = makeTarget();

    await expect(loadSogIntoRenderer(wasm, target, 'https://h/meta.json')).rejects.toThrow();
    expect(target.beginGaussianSplatUpload).not.toHaveBeenCalled();
  });
});

/** Drive a fake streamed load: begin, N appends, end. */
function fakeStream(
  chunks: number[],
  result = { count: 0, shDegree: 1, origin: [9, 9, 9], min: [0, 0, 0], max: [1, 1, 1] },
  splatModel?: string,
) {
  loadStreamedSog.mockImplementation(async (_wasm: SogWasm, _url: string, sink: SplatChunkSink) => {
    const total = chunks.reduce((a, b) => a + b, 0);
    sink.begin({
      totalCount: total,
      shDegree: 1,
      layoutVersion: 2,
      shStride: STRIDE,
      origin: [9, 9, 9],
      ...(splatModel ? { splatModel } : {}),
    });
    for (const n of chunks) sink.append(new Uint32Array(n * STRIDE), meta(n));
    sink.end({ min: [0, 0, 0], max: [1, 1, 1] });
    return { ...result, count: total };
  });
}

describe('progressive display', () => {
  const progressiveTarget = (progressive: boolean) =>
    makeTarget({ isGaussianUploadProgressive: vi.fn(() => progressive) });

  it('should render after the first slice and report first-ready once for a single SOG', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS * 2 + 10;
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(count * STRIDE), meta: meta(count) });
    const { target } = progressiveTarget(true);
    const events: string[] = [];
    (target.render as ReturnType<typeof vi.fn>).mockImplementation(() => events.push('render'));
    const onFirstReady = vi.fn(() => events.push('ready'));
    const onProgress = vi.fn();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { progressive: true, onFirstReady, onProgress });

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(count, 1, 2, undefined, undefined, true);
    expect(onFirstReady).toHaveBeenCalledTimes(1);
    // A frame is requested before first-ready, and again once the load finishes.
    expect(events.slice(0, 2)).toEqual(['render', 'ready']);
    expect(events[events.length - 1]).toBe('render');
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { chunksDone: 1, chunksTotal: 3, splatsDone: SOG_UPLOAD_SLICE_SPLATS, splatsTotal: count },
      { chunksDone: 2, chunksTotal: 3, splatsDone: SOG_UPLOAD_SLICE_SPLATS * 2, splatsTotal: count },
      { chunksDone: 3, chunksTotal: 3, splatsDone: count, splatsTotal: count },
    ]);
  });

  it('should throttle explicit frames between slices', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS * 3;
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(count * STRIDE), meta: meta(count) });
    const { target } = progressiveTarget(true);

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { progressive: true });

    // First slice + the final frame; the two later slices land inside the throttle window.
    expect(target.render).toHaveBeenCalledTimes(2);
  });

  it('should report first-ready only at completion when the renderer cannot draw partial clouds', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = progressiveTarget(false);
    const onFirstReady = vi.fn();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { progressive: true, onFirstReady });

    expect(onFirstReady).toHaveBeenCalledTimes(1);
    expect(target.render).toHaveBeenCalledTimes(1);
  });

  it('should not render between slices or lose first-ready when progressive is off', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = progressiveTarget(true);
    const onFirstReady = vi.fn();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', { onFirstReady });

    expect(target.render).toHaveBeenCalledTimes(1);
    expect(onFirstReady).toHaveBeenCalledTimes(1);
  });

  it('should show a streamed scene after its first chunk', async () => {
    fakeStream([3, 4]);
    const { target } = progressiveTarget(true);
    const order: string[] = [];
    (target.render as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('render'));
    (target.appendGaussianSplats as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('append');
      return true;
    });
    const onFirstReady = vi.fn(() => order.push('ready'));

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json', { progressive: true, onFirstReady });

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(7, 1, 2, undefined, undefined, true);
    expect(order.slice(0, 3)).toEqual(['append', 'render', 'ready']);
    expect(onFirstReady).toHaveBeenCalledTimes(1);
  });
});

describe('loadStreamedSogIntoRenderer', () => {
  it('should begin once, append every chunk, then end with the bounds', async () => {
    fakeStream([3, 4]);
    const { target, appended } = makeTarget();
    const onProgress = vi.fn();

    const info = await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json', { lod: 1, onProgress });

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(7, 1, 2, undefined, undefined, false);
    expect(appended).toEqual([3, 4]);
    expect(target.endGaussianSplatUpload).toHaveBeenCalledWith({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(target.render).toHaveBeenCalledTimes(1);
    expect(info).toMatchObject({ count: 7, origin: [9, 9, 9], layoutVersion: 2, shDegree: 1 });
    expect(loadStreamedSog).toHaveBeenCalledWith(wasm, 'https://h/lod-meta.json', expect.anything(), {
      signal: undefined,
      lod: 1,
      onProgress,
      origin: undefined,
    });
  });

  it('should pass the streamed scene training model to the renderer', async () => {
    fakeStream([2], undefined, 'antialiased');
    const { target } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    expect(target.beginGaussianSplatUpload).toHaveBeenCalledWith(2, 1, 2, undefined, 'antialiased', false);
  });

  it('should pin the origin to zero when world aligned', async () => {
    fakeStream([1]);
    const { target } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json', { worldAligned: true });

    expect(loadStreamedSog.mock.calls[0]![3]).toMatchObject({ origin: [0, 0, 0] });
  });

  it('should pass an explicit origin through to the streamed loader', async () => {
    fakeStream([1]);
    const { target } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json', { origin: [5, 6, 7] });

    expect(loadStreamedSog.mock.calls[0]![3]).toMatchObject({ origin: [5, 6, 7] });
  });

  it('should return a failed info and stop when the renderer rejects the cloud at begin', async () => {
    fakeStream([3]);
    const failed = status({ outcome: 'failed', fallbackReason: 'gpu-sort-unavailable' });
    const { target } = makeTarget({ beginGaussianSplatUpload: vi.fn(() => failed) });

    const info = await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    expect(info.uploadStatus).toBe(failed);
    expect(info.count).toBe(0);
    expect(target.appendGaussianSplats).not.toHaveBeenCalled();
    expect(target.abortGaussianSplatUpload).not.toHaveBeenCalled();
  });

  it('should return a failed info when a chunk append is rejected mid-stream', async () => {
    fakeStream([3, 4]);
    let calls = 0;
    const { target } = makeTarget({
      appendGaussianSplats: vi.fn(() => ++calls < 2),
    });

    const info = await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    expect(info.uploadStatus.outcome).toBe('failed');
    expect(target.endGaussianSplatUpload).not.toHaveBeenCalled();
    expect(target.abortGaussianSplatUpload).not.toHaveBeenCalled();
  });

  it('should abort the upload and rethrow on a network error after it began', async () => {
    loadStreamedSog.mockImplementation(async (_w: SogWasm, _u: string, sink: SplatChunkSink) => {
      sink.begin({ totalCount: 5, shDegree: 1, layoutVersion: 2, shStride: STRIDE, origin: [0, 0, 0] });
      throw new Error('Failed to fetch SOG file (404)');
    });
    const { target } = makeTarget();

    await expect(loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json')).rejects.toThrow(/404/);
    expect(target.abortGaussianSplatUpload).toHaveBeenCalled();
  });

  it('should not abort when the failure happens before the upload began', async () => {
    loadStreamedSog.mockRejectedValue(new Error('lod-meta.json has no tree'));
    const { target } = makeTarget();

    await expect(loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json')).rejects.toThrow(/no tree/);
    expect(target.abortGaussianSplatUpload).not.toHaveBeenCalled();
  });
});

describe('off-thread decoding', () => {
  it('should hand the decoder to the single-dataset loader', async () => {
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(STRIDE), meta: meta(1) });
    const { target } = makeTarget();
    const decoder = vi.fn();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json', {}, { decoder });

    expect(decodeSogDataset.mock.calls[0]![2]).toMatchObject({ decoder });
  });

  it('should hand the decoder and its read-ahead to the streamed loader', async () => {
    fakeStream([1]);
    const { target } = makeTarget();
    const decoder = vi.fn();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json', {}, { decoder, decoderConcurrency: 5 });

    expect(loadStreamedSog.mock.calls[0]![3]).toMatchObject({ decoder, decoderConcurrency: 5 });
  });

  it('should leave the loader options unchanged without a decoder', async () => {
    fakeStream([1]);
    const { target } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    expect(loadStreamedSog.mock.calls[0]![3]).not.toHaveProperty('decoder');
  });
});

describe('prepared slices', () => {
  const prepared = (count: number) => ({ count, shDegree: 1 }) as unknown as PreparedSplatChunk;

  it('should pass each prepared slice with the matching slice of a single dataset', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS + 10;
    const slices = [prepared(SOG_UPLOAD_SLICE_SPLATS), prepared(10)];
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(count * STRIDE), meta: meta(count), prepared: slices });
    const { target, appended } = makeTarget();

    await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(appended).toEqual([SOG_UPLOAD_SLICE_SPLATS, 10]);
    const calls = (target.appendGaussianSplats as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(slices);
  });

  it('should slice a streamed chunk larger than one upload slice and forward its prepared slices', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS + 5;
    const slices = [prepared(SOG_UPLOAD_SLICE_SPLATS), prepared(5)];
    loadStreamedSog.mockImplementation(async (_w: SogWasm, _u: string, sink: SplatChunkSink) => {
      sink.begin({ totalCount: count, shDegree: 1, layoutVersion: 2, shStride: STRIDE, origin: [9, 9, 9] });
      sink.append(new Uint32Array(count * STRIDE), meta(count), slices);
      sink.end({ min: [0, 0, 0], max: [1, 1, 1] });
      return { count, shDegree: 1, origin: [9, 9, 9], min: [0, 0, 0], max: [1, 1, 1] };
    });
    const { target, appended } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    expect(appended).toEqual([SOG_UPLOAD_SLICE_SPLATS, 5]);
    const calls = (target.appendGaussianSplats as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(slices);
  });

  it('should append plain slices when nothing was prepared', async () => {
    fakeStream([3]);
    const { target } = makeTarget();

    await loadStreamedSogIntoRenderer(wasm, target, 'https://h/lod-meta.json');

    const calls = (target.appendGaussianSplats as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![1]).toBeUndefined();
  });

  it('should stop appending once the renderer rejects a slice', async () => {
    const count = SOG_UPLOAD_SLICE_SPLATS * 2;
    decodeSogDataset.mockResolvedValue({ buffer: new Uint32Array(count * STRIDE), meta: meta(count) });
    const { target } = makeTarget({ appendGaussianSplats: vi.fn(() => false) });

    const info = await loadSogIntoRenderer(wasm, target, 'https://h/meta.json');

    expect(target.appendGaussianSplats).toHaveBeenCalledTimes(1);
    expect(info.uploadStatus.outcome).toBe('failed');
  });
});
