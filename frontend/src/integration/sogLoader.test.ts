import { describe, expect, it, vi } from 'vitest';
import type { PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import {
  decodeSogDataset,
  loadStreamedSog,
  lodChunks,
  type SogChunkDecoder,
  parseLodMeta,
  type LodMeta,
  type SogSplatMeta,
  type SogWasm,
  type SplatChunkSink,
} from './sogLoader';

/** Fake SOG wasm: `meta.json` is `{ files: string[], count: number, shDegree?: number, origin?: [..] }`. */
function makeFakeWasm() {
  const sessions = new Map<number, { files: string[]; count: number; shDegree: number; added: string[] }>();
  const gaussians = new Map<number, { buffer: Uint32Array; meta: SogSplatMeta }>();
  const decodeOrigins: Array<readonly number[] | undefined> = [];
  let nextHandle = 1;
  const wasm: SogWasm = {
    sog_open: vi.fn((json: string) => {
      const parsed = JSON.parse(json) as { files: string[]; count: number; shDegree?: number };
      if (!parsed.files) throw new Error('bad meta');
      const handle = nextHandle++;
      sessions.set(handle, { files: parsed.files, count: parsed.count, shDegree: parsed.shDegree ?? 1, added: [] });
      return handle;
    }),
    sog_required_files: vi.fn((handle: number) => sessions.get(handle)!.files),
    sog_add_image: vi.fn((handle: number, name: string, bytes: Uint8Array) => {
      if (bytes.length === 0) throw new Error(`empty image ${name}`);
      sessions.get(handle)!.added.push(name);
    }),
    sog_decode: vi.fn((handle: number, origin?: Float64Array | null) => {
      const session = sessions.get(handle)!;
      sessions.delete(handle);
      const originArray = origin ? Array.from(origin) : undefined;
      decodeOrigins.push(originArray);
      const o = (originArray ?? [100, 200, 300]) as [number, number, number];
      const gaussian = nextHandle++;
      const stride = 17;
      gaussians.set(gaussian, {
        buffer: new Uint32Array(session.count * stride).fill(session.count),
        meta: {
          count: session.count,
          sourceCount: session.count,
          shDegree: session.shDegree,
          shStride: stride,
          layoutVersion: 2,
          layoutName: 'transform-f32-opacity-sh-f16',
          origin: o,
          min: [-session.count, 0, 0],
          max: [session.count, 1, 1],
        },
      });
      return gaussian;
    }),
    sog_free: vi.fn((handle: number) => {
      sessions.delete(handle);
    }),
    gaussian_splat_meta: vi.fn((handle: number) => gaussians.get(handle)!.meta),
    gaussian_splat_buffer_sh: vi.fn((handle: number) => gaussians.get(handle)!.buffer),
    free_gaussian_splats: vi.fn((handle: number) => {
      gaussians.delete(handle);
    }),
  };
  return { wasm, sessions, gaussians, decodeOrigins };
}

/** Serve a URL -> body map; unknown URLs 404. Records every requested URL. */
function makeFetch(files: Record<string, string | Uint8Array>) {
  const requested: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    requested.push(url);
    const body = files[url];
    if (body === undefined) return new Response('nope', { status: 404 });
    return new Response(body as BodyInit, { status: 200 });
  });
  return { fetchImpl, requested };
}

const image = new Uint8Array([1, 2, 3]);

describe('decodeSogDataset', () => {
  it('should fetch meta and every image relative to the meta url, then decode', async () => {
    const { wasm, sessions, gaussians } = makeFakeWasm();
    const { fetchImpl, requested } = makeFetch({
      'https://h/s/meta.json': JSON.stringify({ files: ['a.webp', 'b.webp'], count: 5 }),
      'https://h/s/a.webp': image,
      'https://h/s/b.webp': image,
    });

    const result = await decodeSogDataset(wasm, 'https://h/s/meta.json', { fetchImpl });

    expect(requested.sort()).toEqual(['https://h/s/a.webp', 'https://h/s/b.webp', 'https://h/s/meta.json']);
    expect(result.meta.count).toBe(5);
    expect(result.buffer.length).toBe(5 * 17);
    expect(sessions.size).toBe(0);
    expect(gaussians.size).toBe(0);
  });

  it('should pass the requested origin to the decoder', async () => {
    const { wasm, decodeOrigins } = makeFakeWasm();
    const { fetchImpl } = makeFetch({
      'https://h/meta.json': JSON.stringify({ files: ['a.webp'], count: 1 }),
      'https://h/a.webp': image,
    });

    const result = await decodeSogDataset(wasm, 'https://h/meta.json', { fetchImpl, origin: [1, 2, 3] });

    expect(decodeOrigins).toEqual([[1, 2, 3]]);
    expect(result.meta.origin).toEqual([1, 2, 3]);
  });

  it('should reject with the HTTP status when an image is missing and leak no session', async () => {
    const { wasm, sessions } = makeFakeWasm();
    const { fetchImpl } = makeFetch({
      'https://h/meta.json': JSON.stringify({ files: ['a.webp'], count: 1 }),
    });

    await expect(decodeSogDataset(wasm, 'https://h/meta.json', { fetchImpl })).rejects.toThrow(/404/);
    expect(sessions.size).toBe(0);
  });

  it('should free the session when an image fails to decode', async () => {
    const { wasm, sessions } = makeFakeWasm();
    const { fetchImpl } = makeFetch({
      'https://h/meta.json': JSON.stringify({ files: ['a.webp'], count: 1 }),
      'https://h/a.webp': new Uint8Array(0),
    });

    await expect(decodeSogDataset(wasm, 'https://h/meta.json', { fetchImpl })).rejects.toThrow(/empty image/);
    expect(sessions.size).toBe(0);
    expect(wasm.sog_free).toHaveBeenCalled();
  });

  it('should reject immediately when already aborted', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch({});
    const controller = new AbortController();
    controller.abort();

    await expect(
      decodeSogDataset(wasm, 'https://h/meta.json', { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

const lodMeta = (overrides: Partial<LodMeta> = {}): LodMeta => ({
  version: 1,
  count: 1500,
  counts: [1000, 500],
  lodLevels: 2,
  filenames: ['0_0/meta.json', '0_1/meta.json', '1_0/meta.json'],
  tree: {
    bound: { min: [0, 0, 0], max: [1, 1, 1] },
    children: [
      {
        bound: { min: [0, 0, 0], max: [1, 1, 1] },
        lods: { '0': { file: 0, offset: 0, count: 600 }, '1': { file: 2, offset: 0, count: 300 } },
      },
      {
        bound: { min: [0, 0, 0], max: [1, 1, 1] },
        lods: { '0': { file: 1, offset: 0, count: 400 }, '1': { file: 2, offset: 300, count: 200 } },
      },
    ],
  },
  ...overrides,
});

describe('parseLodMeta', () => {
  it('should accept a valid document', () => {
    expect(parseLodMeta(lodMeta()).lodLevels).toBe(2);
  });

  it.each([
    ['null', null],
    ['future version', { ...lodMeta(), version: 2 }],
    ['no filenames', { ...lodMeta(), filenames: [] }],
    ['no lod levels', { ...lodMeta(), lodLevels: 0 }],
    ['no tree', { ...lodMeta(), tree: undefined }],
  ])('should reject %s', (_name, input) => {
    expect(() => parseLodMeta(input)).toThrow();
  });
});

describe('lodChunks', () => {
  it('should list chunk files of LOD 0 in tree order', () => {
    expect(lodChunks(lodMeta(), 0)).toEqual([
      { file: 0, count: 600 },
      { file: 1, count: 400 },
    ]);
  });

  it('should merge runs that share a chunk file', () => {
    expect(lodChunks(lodMeta(), 1)).toEqual([{ file: 2, count: 500 }]);
  });

  it('should return nothing for a level no leaf has', () => {
    expect(lodChunks(lodMeta(), 5)).toEqual([]);
  });
});

function recordingSink() {
  const events: string[] = [];
  const sink: SplatChunkSink = {
    begin: vi.fn((info) => events.push(`begin:${info.totalCount}:${info.origin.join(',')}`)),
    append: vi.fn((_chunk, meta) => events.push(`append:${meta.count}`)),
    end: vi.fn((bounds) => events.push(`end:${bounds.min[0]}:${bounds.max[0]}`)),
  };
  return { sink, events };
}

const streamedFiles = (extra: Record<string, string | Uint8Array> = {}) => ({
  'https://h/s/lod-meta.json': JSON.stringify(lodMeta()),
  'https://h/s/0_0/meta.json': JSON.stringify({ files: ['x.webp'], count: 600 }),
  'https://h/s/0_0/x.webp': image,
  'https://h/s/0_1/meta.json': JSON.stringify({ files: ['x.webp'], count: 400 }),
  'https://h/s/0_1/x.webp': image,
  ...extra,
});

describe('loadStreamedSog', () => {
  it('should stream chunks in order and share the first chunk origin', async () => {
    const { wasm, decodeOrigins } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink, events } = recordingSink();
    const onProgress = vi.fn();

    const result = await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, onProgress });

    expect(events).toEqual(['begin:1000:100,200,300', 'append:600', 'append:400', 'end:-600:600']);
    expect(decodeOrigins).toEqual([undefined, [100, 200, 300]]);
    expect(result).toMatchObject({ count: 1000, shDegree: 1, origin: [100, 200, 300] });
    expect(onProgress).toHaveBeenLastCalledWith({
      chunksDone: 2,
      chunksTotal: 2,
      splatsDone: 1000,
      splatsTotal: 1000,
    });
  });

  it('should hand each chunk buffer to the sink as decoded', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();

    await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl });

    const chunks = (sink.append as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as Uint32Array).length);
    expect(chunks).toEqual([600 * 17, 400 * 17]);
  });

  it('should decode every chunk with a pinned origin when one is given', async () => {
    const { wasm, decodeOrigins } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink, events } = recordingSink();

    const result = await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, {
      fetchImpl,
      origin: [0, 0, 0],
    });

    expect(decodeOrigins).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(events[0]).toBe('begin:1000:0,0,0');
    expect(result.origin).toEqual([0, 0, 0]);
  });

  it('should fail on an unavailable LOD level', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();

    await expect(
      loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, lod: 7 }),
    ).rejects.toThrow(/LOD 7/);
    expect(sink.begin).not.toHaveBeenCalled();
  });

  it('should reject when a chunk fails to download without calling end', async () => {
    const { wasm } = makeFakeWasm();
    const files = streamedFiles();
    delete (files as Record<string, unknown>)['https://h/s/0_1/x.webp'];
    const { fetchImpl } = makeFetch(files);
    const { sink } = recordingSink();

    await expect(loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl })).rejects.toThrow(/404/);
    expect(sink.end).not.toHaveBeenCalled();
  });

  it('should reject chunks with a different SH degree', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(
      streamedFiles({ 'https://h/s/0_1/meta.json': JSON.stringify({ files: ['x.webp'], count: 400, shDegree: 3 }) }),
    );
    const { sink } = recordingSink();

    await expect(loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl })).rejects.toThrow(/SH degrees/);
  });

  it('should stop between chunks when aborted', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const controller = new AbortController();
    const { sink } = recordingSink();
    (sink.append as ReturnType<typeof vi.fn>).mockImplementation(() => controller.abort());

    await expect(
      loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(sink.append).toHaveBeenCalledTimes(1);
    expect(sink.end).not.toHaveBeenCalled();
  });
});

/** A decoder backed by the fake wasm, as a worker pool would provide. */
function wasmDecoder(wasm: SogWasm, fetchImpl: ReturnType<typeof makeFetch>['fetchImpl']): SogChunkDecoder {
  return (metaUrl, origin) => decodeSogDataset(wasm, metaUrl, { fetchImpl, origin });
}

describe('off-thread decoder', () => {
  it('should decode a single dataset through the decoder instead of the local wasm', async () => {
    const { wasm } = makeFakeWasm();
    const decoder = vi.fn(async () => ({ buffer: new Uint32Array(17), meta: { count: 1 } as SogSplatMeta }));

    const result = await decodeSogDataset(wasm, 'https://h/meta.json', { decoder, origin: [1, 2, 3] });

    expect(decoder).toHaveBeenCalledWith('https://h/meta.json', [1, 2, 3]);
    expect(result.meta.count).toBe(1);
    expect(wasm.sog_open).not.toHaveBeenCalled();
  });

  it('should stream chunks in order, decoding the first alone to fix the shared origin', async () => {
    const { wasm, decodeOrigins } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink, events } = recordingSink();
    const decoder = vi.fn(wasmDecoder(wasm, fetchImpl));

    const result = await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, decoder });

    expect(events).toEqual(['begin:1000:100,200,300', 'append:600', 'append:400', 'end:-600:600']);
    expect(decodeOrigins).toEqual([undefined, [100, 200, 300]]);
    expect(decoder.mock.calls.map((c) => c[0])).toEqual(['https://h/s/0_0/meta.json', 'https://h/s/0_1/meta.json']);
    expect(result).toMatchObject({ count: 1000, origin: [100, 200, 300] });
  });

  it('should hold back later chunks until the first has fixed the origin', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = wasmDecoder(wasm, fetchImpl);
    const decoder = vi.fn<SogChunkDecoder>(async (url, origin) => {
      await gate;
      return inner(url, origin);
    });

    const load = loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, decoder });
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(decoder).toHaveBeenCalledTimes(1);

    release();
    await load;
    expect(decoder).toHaveBeenCalledTimes(2);
  });

  it('should start every chunk at once when the origin is pinned', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = wasmDecoder(wasm, fetchImpl);
    const decoder = vi.fn<SogChunkDecoder>(async (url, origin) => {
      await gate;
      return inner(url, origin);
    });

    const load = loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, {
      fetchImpl,
      decoder,
      origin: [0, 0, 0],
    });
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(2));
    expect(decoder.mock.calls.map((c) => c[1])).toEqual([[0, 0, 0], [0, 0, 0]]);

    release();
    await load;
  });

  it('should forward prepared slices from the decoder to the sink', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();
    const prepared = [{ count: 1 }] as unknown as PreparedSplatChunk[];
    const inner = wasmDecoder(wasm, fetchImpl);
    const decoder: SogChunkDecoder = async (url, origin) => ({ ...(await inner(url, origin)), prepared });

    await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, decoder });

    const calls = (sink.append as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[2])).toEqual([prepared, prepared]);
  });

  it('should keep at most decoderConcurrency chunks ahead of the consumer', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();
    const decoder = vi.fn(wasmDecoder(wasm, fetchImpl));

    await loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, {
      fetchImpl,
      decoder,
      origin: [0, 0, 0],
      decoderConcurrency: 1,
    });

    expect(decoder).toHaveBeenCalledTimes(2);
  });

  it('should surface a decoder failure and not an unhandled rejection from read-ahead chunks', async () => {
    const { wasm } = makeFakeWasm();
    const { fetchImpl } = makeFetch(streamedFiles());
    const { sink } = recordingSink();
    const decoder = vi.fn<SogChunkDecoder>(async () => {
      throw new Error('worker crashed');
    });

    await expect(
      loadStreamedSog(wasm, 'https://h/s/lod-meta.json', sink, { fetchImpl, decoder, origin: [0, 0, 0] }),
    ).rejects.toThrow(/worker crashed/);
    expect(sink.end).not.toHaveBeenCalled();
  });
});
