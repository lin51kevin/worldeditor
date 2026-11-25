import { describe, expect, it, vi } from 'vitest';
import type { SogWorkerLike, SogWorkerRequest, SogWorkerResponse } from './sogDecodePool';
import { defaultDecodeWorkers, openSogDecoder, openSogDecoderFor } from './sogDecoderSession';
import type { SogWasm } from './sogLoader';

class FakeWorker implements SogWorkerLike {
  onmessage: ((event: { data: SogWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  requests: SogWorkerRequest[] = [];
  terminated = false;
  postMessage(message: SogWorkerRequest): void {
    this.requests.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const wasm = {} as SogWasm;

function open(overrides: Partial<Parameters<typeof openSogDecoder>[0]> = {}) {
  const workers: FakeWorker[] = [];
  const session = openSogDecoder({
    wasm,
    source: 'https://h/we.wasm',
    workers: 2,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    ...overrides,
  });
  return { session, workers };
}

describe('defaultDecodeWorkers', () => {
  it.each([
    [undefined, 2],
    [2, 1],
    [4, 2],
    [8, 6],
    [32, 6],
  ])('should use %s logical cores for %s workers', (cores, expected) => {
    expect(defaultDecodeWorkers(cores)).toBe(expected);
  });
});

describe('openSogDecoder', () => {
  it('should stay on the calling thread when workers are disabled', () => {
    const { session, workers } = open({ workers: 0 });
    expect(session.decoder).toBeUndefined();
    expect(workers).toHaveLength(0);
    expect(() => session.dispose()).not.toThrow();
  });

  it('should stay on the calling thread without a wasm source or a worker factory', () => {
    expect(open({ source: undefined }).session.decoder).toBeUndefined();
    expect(open({ createWorker: undefined }).session.decoder).toBeUndefined();
  });

  it('should fall back to the calling thread when a worker cannot be created', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = open({
      createWorker: () => {
        throw new Error('blocked by CSP');
      },
    });
    expect(session.decoder).toBeUndefined();
    warn.mockRestore();
  });

  it('should offer a decoder that reads ahead one chunk more than there are workers', () => {
    const { session, workers } = open({ workers: 3 });
    expect(session.decoder).toBeTypeOf('function');
    expect(session.decoderConcurrency).toBe(4);
    expect(workers).toHaveLength(3);
  });

  it('should hand work to the pool', () => {
    const { session, workers } = open({ workers: 1 });
    void session.decoder!('https://h/a/meta.json', [1, 2, 3]).catch(() => undefined);
    expect(workers[0]!.requests.at(-1)).toMatchObject({ type: 'decode', url: 'https://h/a/meta.json', origin: [1, 2, 3] });
  });

  it('should terminate the workers on dispose', () => {
    const { session, workers } = open();
    session.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('should abort pending decodes when the load is cancelled', async () => {
    const controller = new AbortController();
    const { session, workers } = open({ workers: 1, signal: controller.signal });
    const job = session.decoder!('https://h/a/meta.json', undefined);

    controller.abort();

    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('should decode on the calling thread once the workers prove unusable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const localWasm = {
      sog_open: vi.fn(() => {
        throw new Error('local decode used');
      }),
    } as unknown as SogWasm;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { session, workers } = open({ wasm: localWasm, workers: 1 });

    const job = session.decoder!('https://h/a/meta.json', undefined);
    workers[0]!.onerror?.({ message: 'script failed' });

    await expect(job).rejects.toThrow(/local decode used/);
    expect(localWasm.sog_open).toHaveBeenCalled();
    fetchSpy.mockRestore();
    warn.mockRestore();
  });
});

describe('openSogDecoderFor', () => {
  const factoryOf = (workers: FakeWorker[]) =>
    vi.fn(async () => () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as SogWorkerLike;
    });

  it('should use a single worker for one dataset', async () => {
    const workers: FakeWorker[] = [];
    const session = await openSogDecoderFor(wasm, 'https://h/we.wasm', false, {}, factoryOf(workers));
    expect(workers).toHaveLength(1);
    expect(session.decoder).toBeTypeOf('function');
  });

  it('should honour an explicit worker count for a streamed scene', async () => {
    const workers: FakeWorker[] = [];
    await openSogDecoderFor(wasm, 'https://h/we.wasm', true, { decodeWorkers: 3 }, factoryOf(workers));
    expect(workers).toHaveLength(3);
  });

  it('should not even load the worker bundle when decodeWorkers is 0', async () => {
    const loadFactory = vi.fn();
    const session = await openSogDecoderFor(wasm, 'https://h/we.wasm', true, { decodeWorkers: 0 }, loadFactory);
    expect(session.decoder).toBeUndefined();
    expect(loadFactory).not.toHaveBeenCalled();
  });

  it('should not load the worker bundle when the host gave no wasm location', async () => {
    const loadFactory = vi.fn();
    const session = await openSogDecoderFor(wasm, undefined, true, {}, loadFactory);
    expect(session.decoder).toBeUndefined();
    expect(loadFactory).not.toHaveBeenCalled();
  });

  it('should decode on the calling thread when the worker bundle cannot load', async () => {
    const session = await openSogDecoderFor(wasm, 'https://h/we.wasm', true, {}, async () => undefined);
    expect(session.decoder).toBeUndefined();
  });
});
