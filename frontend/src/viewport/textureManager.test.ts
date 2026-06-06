import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TextureManager } from './textureManager';
import type { TextureManifest } from './textureManager';

// Minimal GPUDevice mock — only the parts TextureManager uses.
function makeMockDevice() {
  const mockTexture = {
    createView: vi.fn().mockReturnValue({}),
    destroy: vi.fn(),
  };
  return {
    createSampler: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockReturnValue(mockTexture),
    queue: {
      writeTexture: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
    },
    _mockTexture: mockTexture,
  };
}

const SAMPLE_MANIFEST: TextureManifest = {
  basePath: '/assets/textures',
  trafficLights: {
    '1000001': 'traffic_light.png',
    '1000001:-1': 'traffic_light_all.png',
  },
  roadPaints: {
    _default: 'paint_default.png',
    forward_arrow: 'arrow_forward.png',
  },
  roadSigns: {
    _prefix: 'sign_',
    _suffix: '.png',
    _speedLimitBase: '274',
  },
  objects: {
    Guardrail: 'guardrail_thumb.png',
    Crosswalk: 'crosswalk_thumb.png',
  },
};

function makeManagerWithManifest(manifest: TextureManifest): TextureManager {
  const device = makeMockDevice();
  const mgr = new TextureManager(device as unknown as GPUDevice);
  // Inject manifest directly by mocking fetch so loadManifest succeeds.
  (mgr as unknown as { manifest: TextureManifest }).manifest = manifest;
  return mgr;
}

describe('TextureManager — resolveSignalTexture', () => {
  let mgr: TextureManager;

  beforeEach(() => {
    mgr = makeManagerWithManifest(SAMPLE_MANIFEST);
  });

  it('returns null when manifest is not loaded', () => {
    const device = makeMockDevice();
    const fresh = new TextureManager(device as unknown as GPUDevice);
    expect(fresh.resolveSignalTexture('1000001', '-1')).toBeNull();
  });

  it('resolves traffic light by type code', () => {
    const url = mgr.resolveSignalTexture('1000001', 'other');
    expect(url).toBe('/assets/textures/traffic_light.png');
  });

  it('resolves traffic light by composite key type:subtype', () => {
    const url = mgr.resolveSignalTexture('1000001', '-1');
    expect(url).toBe('/assets/textures/traffic_light_all.png');
  });

  it('resolves Graphics type (road paint) by subtype', () => {
    const url = mgr.resolveSignalTexture('Graphics', 'forward_arrow');
    expect(url).toBe('/assets/textures/arrow_forward.png');
  });

  it('returns road paint default fallback when subtype not found', () => {
    const url = mgr.resolveSignalTexture('Graphics', 'unknown_paint');
    expect(url).toBe('/assets/textures/paint_default.png');
  });

  it('returns null for Graphics type when no default and subtype missing', () => {
    const manifest: TextureManifest = { ...SAMPLE_MANIFEST, roadPaints: {} };
    const m = makeManagerWithManifest(manifest);
    expect(m.resolveSignalTexture('Graphics', 'nonexistent')).toBeNull();
  });

  it('resolves speed limit sign using value', () => {
    const url = mgr.resolveSignalTexture('274', '-1', '60');
    expect(url).toBe('/assets/textures/sign_274_60.png');
  });

  it('resolves speed limit sign using subtype as fallback when value absent', () => {
    const url = mgr.resolveSignalTexture('274', '80');
    expect(url).toBe('/assets/textures/sign_274_80.png');
  });

  it('returns generic sign path for unknown type', () => {
    const url = mgr.resolveSignalTexture('206', '-1');
    expect(url).toBe('/assets/textures/sign_206.png');
  });

  it('strips commas from type code', () => {
    const url = mgr.resolveSignalTexture('1,2,3', '-1');
    // commas removed → '123'
    expect(url).toBe('/assets/textures/sign_123.png');
  });
});

describe('TextureManager — resolveObjectThumbnail', () => {
  let mgr: TextureManager;

  beforeEach(() => {
    mgr = makeManagerWithManifest(SAMPLE_MANIFEST);
  });

  it('returns null when manifest is not loaded', () => {
    const device = makeMockDevice();
    const fresh = new TextureManager(device as unknown as GPUDevice);
    expect(fresh.resolveObjectThumbnail('Guardrail')).toBeNull();
  });

  it('resolves known object type', () => {
    expect(mgr.resolveObjectThumbnail('Guardrail')).toBe('/assets/textures/guardrail_thumb.png');
    expect(mgr.resolveObjectThumbnail('Crosswalk')).toBe('/assets/textures/crosswalk_thumb.png');
  });

  it('returns null for unknown object type', () => {
    expect(mgr.resolveObjectThumbnail('UnknownThing')).toBeNull();
  });
});

describe('TextureManager — cache and state', () => {
  it('isLoaded returns false initially for any URL', () => {
    const device = makeMockDevice();
    const mgr = new TextureManager(device as unknown as GPUDevice);
    expect(mgr.isLoaded('/some/texture.png')).toBe(false);
  });

  it('getSampler returns the device sampler', () => {
    const device = makeMockDevice();
    const mgr = new TextureManager(device as unknown as GPUDevice);
    expect(mgr.getSampler()).toBeDefined();
    expect(device.createSampler).toHaveBeenCalledOnce();
  });

  it('getTexture returns placeholder while real texture loads', () => {
    const device = makeMockDevice();
    const mockTexture = device._mockTexture;
    // Stall the fetch so the texture never finishes loading.
    const fetchSpy = vi.stubGlobal('fetch', () => new Promise(() => { /* never resolves */ }));
    const mgr = new TextureManager(device as unknown as GPUDevice);

    const tex = mgr.getTexture('/textures/test.png');
    // Must return placeholder (non-null GPUTexture)
    expect(tex).toBeDefined();
    expect(device.createTexture).toHaveBeenCalled();
    // isLoaded still false — async load not done
    expect(mgr.isLoaded('/textures/test.png')).toBe(false);

    vi.unstubAllGlobals();
    void fetchSpy; // suppress unused var warning
  });

  it('loadManifest handles fetch failure gracefully', async () => {
    const device = makeMockDevice();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const mgr = new TextureManager(device as unknown as GPUDevice);
    // Should not throw
    await expect(mgr.loadManifest()).resolves.toBeUndefined();
    // resolveSignalTexture returns null without manifest
    expect(mgr.resolveSignalTexture('1000001', '-1')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('loadManifest parses and stores manifest from fetch', async () => {
    const manifest = {
      basePath: '/textures',
      trafficLights: { 'abc': 'abc.png' },
      roadPaints: {},
      roadSigns: { _prefix: '', _suffix: '', _speedLimitBase: '' },
      objects: {},
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(manifest),
    }));
    vi.stubGlobal('getAssetUrl', (path: string) => path);

    const device = makeMockDevice();
    const mgr = new TextureManager(device as unknown as GPUDevice);
    await mgr.loadManifest();
    // After load, resolveSignalTexture uses manifest
    const url = mgr.resolveSignalTexture('abc', 'x');
    expect(url).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it('destroy clears internal state', () => {
    const device = makeMockDevice();
    const mgr = new TextureManager(device as unknown as GPUDevice);
    // Force placeholder creation then destroy
    vi.stubGlobal('fetch', () => new Promise(() => { /* never */ }));
    mgr.getTexture('/t.png');
    vi.unstubAllGlobals();
    mgr.destroy();
    // After destroy, isLoaded is reset
    expect(mgr.isLoaded('/t.png')).toBe(false);
  });
});
