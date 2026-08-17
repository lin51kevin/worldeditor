import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActorSplatInstancer, type ActorInstance } from './actorSplatInstancer';
import type { SplatSorter } from './splatSortController';

const DEGREE0_STRIDE = 12;

/** Minimal fake GPUDevice: records buffer writes, no-ops pipeline creation. */
function fakeDevice(limits?: Partial<GPUSupportedLimits>) {
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
    limits,
  } as unknown as GPUDevice;
  return device;
}

/** Device limits that hold exactly `splats` degree-0 splats in the merged buffer. */
function limitsForSplats(splats: number): Partial<GPUSupportedLimits> {
  const bytes = splats * DEGREE0_STRIDE * Uint32Array.BYTES_PER_ELEMENT;
  return { maxStorageBufferBindingSize: bytes, maxBufferSize: bytes };
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

  it('thins proportionally so the total stays within a pinned budget', () => {
    const { sorter, lastCount } = recordingSorter();
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    inst.setSplatBudget(1500);
    inst.uploadModel('a', makeModel(1000));
    inst.updateInstances([instance('a'), instance('a')]);

    expect(inst.count).toBeLessThanOrEqual(1500);
    expect(inst.count).toBeGreaterThan(0);
    // World positions handed to the sorter match the capped merged count.
    expect(lastCount()).toBe(inst.count);
  });

  it('rebuilds with the new budget even when the instance set is unchanged', () => {
    const { sorter } = recordingSorter();
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    inst.uploadModel('a', makeModel(1000));
    inst.updateInstances([instance('a'), instance('a')]);
    expect(inst.count).toBe(2000);

    inst.setSplatBudget(500);
    inst.updateInstances([instance('a'), instance('a')]);
    expect(inst.count).toBeLessThanOrEqual(500);
  });

  it('keeps every splat when the device limits can hold the merged cloud', () => {
    const { sorter } = recordingSorter();
    const device = fakeDevice(limitsForSplats(100_000));
    const inst = new ActorSplatInstancer(device, 'rgba8unorm', undefined, sorter);

    inst.uploadModel('a', makeModel(30_000));
    inst.updateInstances([instance('a'), instance('a')]);

    expect(inst.count).toBe(60_000);
  });

  it('thins to the device limits when the merged cloud would not fit', () => {
    const { sorter, lastCount } = recordingSorter();
    const device = fakeDevice(limitsForSplats(100_000));
    const inst = new ActorSplatInstancer(device, 'rgba8unorm', undefined, sorter);

    inst.uploadModel('a', makeModel(30_000));
    inst.updateInstances(Array.from({ length: 5 }, () => instance('a'))); // 150k raw

    expect(inst.count).toBeLessThanOrEqual(100_000);
    expect(inst.count).toBeGreaterThan(0);
    expect(lastCount()).toBe(inst.count);
  });

  it('does not throw when the raw total is enormous', () => {
    const { sorter } = recordingSorter();
    // No device limits reported → the built-in fallback budget applies.
    const inst = new ActorSplatInstancer(fakeDevice(), 'rgba8unorm', undefined, sorter);

    inst.uploadModel('m', makeModel(1_000_000));
    const many = Array.from({ length: 50 }, () => instance('m')); // 50M raw

    expect(() => inst.updateInstances(many)).not.toThrow();
    expect(inst.count).toBeLessThanOrEqual(2_000_000);
  });
});
