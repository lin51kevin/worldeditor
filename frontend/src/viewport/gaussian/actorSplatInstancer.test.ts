import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActorSplatInstancer, type ActorInstance } from './actorSplatInstancer';
import type { SplatSorter } from './splatSortController';

const DEGREE0_STRIDE = 12;

/** Minimal fake GPUDevice: records buffer writes, no-ops pipeline creation. */
function fakeDevice() {
  const device = {
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createBuffer: (desc: { size: number }) => ({
      size: desc.size,
      destroy() {},
    }),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  return device;
}

/** Sorter stub that records the splat count handed to it via `init`. */
function recordingSorter(): { sorter: SplatSorter; lastCount: () => number } {
  let lastLen = 0;
  const sorter: SplatSorter = {
    init: (positions: Float32Array) => {
      lastLen = positions.length;
    },
    sort: () => {},
    dispose: () => {},
  };
  return { sorter, lastCount: () => lastLen / 3 };
}

/** A packed degree-0 model of `count` splats with `x = i` in each record. */
function makeModel(count: number): Uint32Array {
  const data = new Uint32Array(count * DEGREE0_STRIDE);
  const f = new Float32Array(data.buffer);
  for (let i = 0; i < count; i++) f[i * DEGREE0_STRIDE] = i;
  return data;
}

function instance(url: string): ActorInstance {
  return { url, cos_yaw: 1, sin_yaw: 0, hw: 1, hz: 0, px: 0, py: 0, pz: 0 };
}

describe('ActorSplatInstancer capping', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('keeps the full count when the raw total is within budget', () => {
    const { sorter, lastCount } = recordingSorter();
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    inst.uploadModel('a', makeModel(1000));
    inst.updateInstances([instance('a'), instance('a')]);

    expect(inst.count).toBe(2000);
    expect(lastCount()).toBe(2000);
  });

  it('thins proportionally so the total stays within the global budget', () => {
    const { sorter, lastCount } = recordingSorter();
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    // One 1.5M-splat model used by two actors → raw total 3M > 2M budget.
    inst.uploadModel('big', makeModel(1_500_000));
    inst.updateInstances([instance('big'), instance('big')]);

    expect(inst.count).toBeLessThanOrEqual(2_000_000);
    expect(inst.count).toBeGreaterThan(0);
    // World positions handed to the sorter match the capped merged count.
    expect(lastCount()).toBe(inst.count);
  });

  it('does not throw when the raw total is enormous', () => {
    const { sorter } = recordingSorter();
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    inst.uploadModel('m', makeModel(1_000_000));
    const many = Array.from({ length: 50 }, () => instance('m')); // 50M raw

    expect(() => inst.updateInstances(many)).not.toThrow();
    expect(inst.count).toBeLessThanOrEqual(2_000_000);
  });
});
