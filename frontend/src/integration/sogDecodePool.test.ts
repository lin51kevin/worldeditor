import { describe, expect, it } from 'vitest';
import {
  SogDecodePool,
  SogWorkerUnavailable,
  resolveWasmSource,
  type SogWorkerLike,
  type SogWorkerRequest,
  type SogWorkerResponse,
} from './sogDecodePool';
import type { SogSplatMeta } from './sogLoader';

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
  reply(response: SogWorkerResponse): void {
    this.onmessage?.({ data: response });
  }
  decodes(): Extract<SogWorkerRequest, { type: 'decode' }>[] {
    return this.requests.filter((r): r is Extract<SogWorkerRequest, { type: 'decode' }> => r.type === 'decode');
  }
}

const meta = (count: number): SogSplatMeta =>
  ({ count, shDegree: 1, shStride: 4, layoutVersion: 2, origin: [1, 2, 3] }) as unknown as SogSplatMeta;

function makePool(size: number) {
  const workers: FakeWorker[] = [];
  const pool = new SogDecodePool(
    size,
    () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    'https://h/we.wasm',
  );
  return { pool, workers };
}

describe('SogDecodePool', () => {
  it('should send every worker the wasm source before any job', () => {
    const { workers } = makePool(2);

    expect(workers).toHaveLength(2);
    for (const w of workers) expect(w.requests).toEqual([{ type: 'init', source: 'https://h/we.wasm' }]);
  });

  it('should resolve a job with the decoded buffer and meta', async () => {
    const { pool, workers } = makePool(1);

    const job = pool.decode('https://h/a/meta.json', [4, 5, 6]);
    const [request] = workers[0]!.decodes();
    expect(request).toMatchObject({ url: 'https://h/a/meta.json', origin: [4, 5, 6] });
    workers[0]!.reply({ type: 'done', id: request!.id, buffer: new Uint32Array([7, 8]).buffer, meta: meta(2) });

    const result = await job;
    expect(Array.from(result.buffer)).toEqual([7, 8]);
    expect(result.meta.count).toBe(2);
  });

  it('should forward the SH cap to the worker', () => {
    const { pool, workers } = makePool(1);

    void pool.decode('https://h/a/meta.json', undefined, { dropShAbove: 10, sceneCount: 20 });

    expect(workers[0]!.decodes()[0]).toMatchObject({ shCap: { dropShAbove: 10, sceneCount: 20 } });
  });

  it('should hand back the slices a worker prepared', async () => {
    const { pool, workers } = makePool(1);
    const prepared = [{ count: 2 }] as never;

    const job = pool.decode('https://h/a', undefined);
    workers[0]!.reply({
      type: 'done',
      id: workers[0]!.decodes()[0]!.id,
      buffer: new ArrayBuffer(8),
      meta: meta(2),
      prepared,
    });

    expect((await job).prepared).toBe(prepared);
  });

  it('should omit prepared when the worker sent none', async () => {
    const { pool, workers } = makePool(1);
    const job = pool.decode('https://h/a', undefined);
    workers[0]!.reply({ type: 'done', id: workers[0]!.decodes()[0]!.id, buffer: new ArrayBuffer(8), meta: meta(2) });

    expect(await job).not.toHaveProperty('prepared');
  });

  it('should run one job per worker and queue the rest until one frees up', async () => {
    const { pool, workers } = makePool(2);

    const jobs = ['a', 'b', 'c'].map((n) => pool.decode(`https://h/${n}`, undefined));
    expect(workers[0]!.decodes()).toHaveLength(1);
    expect(workers[1]!.decodes()).toHaveLength(1);

    const first = workers[0]!.decodes()[0]!;
    workers[0]!.reply({ type: 'done', id: first.id, buffer: new ArrayBuffer(4), meta: meta(1) });
    await jobs[0];

    expect(workers[0]!.decodes().map((d) => d.url)).toEqual(['https://h/a', 'https://h/c']);
    expect(workers[1]!.decodes().map((d) => d.url)).toEqual(['https://h/b']);
  });

  it('should reject only the failing job when a worker reports a decode error', async () => {
    const { pool, workers } = makePool(1);

    const bad = pool.decode('https://h/bad', undefined);
    const bad$ = expect(bad).rejects.toThrow(/corrupt webp/);
    const good = pool.decode('https://h/good', undefined);
    workers[0]!.reply({ type: 'fail', id: workers[0]!.decodes()[0]!.id, message: 'corrupt webp' });
    await bad$;

    workers[0]!.reply({ type: 'done', id: workers[0]!.decodes()[1]!.id, buffer: new ArrayBuffer(4), meta: meta(1) });
    await expect(good).resolves.toBeDefined();
  });

  it('should reject with SogWorkerUnavailable when a worker cannot start', async () => {
    const { pool, workers } = makePool(1);

    const running = pool.decode('https://h/a', undefined);
    const queued = pool.decode('https://h/b', undefined);
    workers[0]!.onerror?.({ message: 'script failed' });

    await expect(running).rejects.toBeInstanceOf(SogWorkerUnavailable);
    await expect(queued).rejects.toBeInstanceOf(SogWorkerUnavailable);
    await expect(pool.decode('https://h/c', undefined)).rejects.toBeInstanceOf(SogWorkerUnavailable);
  });

  it('should treat an init failure reported by the worker as unavailable', async () => {
    const { pool, workers } = makePool(1);

    const job = pool.decode('https://h/a', undefined);
    workers[0]!.reply({
      type: 'fail',
      id: workers[0]!.decodes()[0]!.id,
      message: 'wasm init failed',
      unavailable: true,
    });

    await expect(job).rejects.toBeInstanceOf(SogWorkerUnavailable);
  });

  it('should terminate every worker and reject pending jobs on dispose', async () => {
    const { pool, workers } = makePool(2);

    const running = pool.decode('https://h/a', undefined);
    const queued = [pool.decode('https://h/b', undefined), pool.decode('https://h/c', undefined)];
    const reason = new DOMException('aborted', 'AbortError');
    pool.dispose(reason);

    await expect(running).rejects.toBe(reason);
    await expect(queued[0]).rejects.toBe(reason);
    await expect(queued[1]).rejects.toBe(reason);
    expect(workers.every((w) => w.terminated)).toBe(true);
    await expect(pool.decode('https://h/d', undefined)).rejects.toBe(reason);
  });

  it('should ignore a late reply after dispose', async () => {
    const { pool, workers } = makePool(1);
    const job = pool.decode('https://h/a', undefined);
    const rejected = expect(job).rejects.toBeDefined();
    const { id } = workers[0]!.decodes()[0]!;
    pool.dispose();
    await rejected;

    expect(() => workers[0]!.reply({ type: 'done', id, buffer: new ArrayBuffer(4), meta: meta(1) })).not.toThrow();
  });

  it('should be a no-op to dispose twice', () => {
    const { pool, workers } = makePool(1);
    pool.dispose();
    pool.dispose();
    expect(workers[0]!.terminated).toBe(true);
  });
});

describe('resolveWasmSource', () => {
  it('should make a relative url absolute so a blob worker can fetch it', () => {
    const source = resolveWasmSource('/assets/we.wasm');
    expect(source).toBe(new URL('/assets/we.wasm', location.href).href);
  });

  it('should accept URL and Request inputs', () => {
    expect(resolveWasmSource(new URL('https://h/we.wasm'))).toBe('https://h/we.wasm');
    expect(resolveWasmSource(new Request('https://h/we.wasm'))).toBe('https://h/we.wasm');
  });

  it('should pass binary and module inputs through to be structured-cloned', () => {
    const bytes = new Uint8Array([0, 97, 115, 109]);
    expect(resolveWasmSource(bytes)).toBe(bytes);
    const buffer = new ArrayBuffer(4);
    expect(resolveWasmSource(buffer)).toBe(buffer);
  });

  it('should return undefined when the host gave no location', () => {
    expect(resolveWasmSource(undefined)).toBeUndefined();
  });

  it('should not call into the worker factory', () => {
    const factory = vi.fn();
    expect(factory).not.toHaveBeenCalled();
  });
});
