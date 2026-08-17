import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Fake worker: records posted messages, replies only when the test says so. */
class FakeWorker {
  static last: FakeWorker | null = null;
  readonly posted: { type: string; generation?: number }[] = [];
  onmessage: ((ev: MessageEvent<unknown>) => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(msg: { type: string; generation?: number }): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Emit the worker's `init` acknowledgement. */
  ack(): void {
    this.onmessage?.({ data: { type: 'inited' } } as MessageEvent<unknown>);
  }

  /** Emit a sort result sized for whichever cloud the worker "held". */
  answerSort(generation: number, count: number): void {
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    this.onmessage?.({
      data: { type: 'sorted', indices, visibleCount: count, generation },
    } as MessageEvent<unknown>);
  }

  get postedTypes(): string[] {
    return this.posted.map((m) => m.type);
  }
}

vi.mock('./splatSortWorker.ts?worker&inline', () => ({ default: FakeWorker }));

const { createWorkerSplatSorter } = await import('./splatSorterBackends');

const CAM: [number, number, number] = [0, 0, 0];
const DIR: [number, number, number] = [0, 0, 1];

/** Positions buffer for `count` splats (3 floats each). */
function positions(count: number): Float32Array {
  return new Float32Array(count * 3);
}

describe('createWorkerSplatSorter positions/sort fencing', () => {
  beforeEach(() => {
    FakeWorker.last = null;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  });

  it('holds back a sort until stashed positions reach the worker', () => {
    const sorter = createWorkerSplatSorter();
    const worker = FakeWorker.last!;
    const done = vi.fn();

    sorter.init(positions(3)); // posted immediately
    sorter.init(positions(2)); // stashed: the first init is unacknowledged
    sorter.sort(CAM, DIR, 1, done);

    // The worker still holds the 3-splat cloud, so the sort must not be posted:
    // it would come back sized for the wrong cloud.
    expect(worker.postedTypes).toEqual(['init']);

    worker.ack();

    // Stashed positions go first, then the held-back sort.
    expect(worker.postedTypes).toEqual(['init', 'init', 'sort']);

    worker.answerSort(1, 2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toHaveLength(2);
  });

  it('drops a sort answered against superseded positions', () => {
    const sorter = createWorkerSplatSorter();
    const worker = FakeWorker.last!;
    const done = vi.fn();

    sorter.init(positions(3));
    sorter.sort(CAM, DIR, 1, done); // legitimately posted against the 3-splat cloud
    expect(worker.postedTypes).toEqual(['init', 'sort']);

    sorter.init(positions(2)); // supersedes; stashed while the first init is in flight
    worker.answerSort(1, 3); // straggler sized for the OLD cloud

    expect(done).not.toHaveBeenCalled();
  });

  it('posts a sort straight through when positions are current', () => {
    const sorter = createWorkerSplatSorter();
    const worker = FakeWorker.last!;
    const done = vi.fn();

    sorter.init(positions(4));
    worker.ack();
    sorter.sort(CAM, DIR, 7, done);

    expect(worker.postedTypes).toEqual(['init', 'sort']);
    worker.answerSort(7, 4);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
