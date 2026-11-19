import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportRenderer, computeGroundPanOffset, resolveMouseDragAction } from './renderer';

describe('resolveMouseDragAction', () => {
  it('maps plain left-button drag to pan', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: false, altKey: false })).toBe('pan');
  });

  it('maps right-button drag to fly in 3D (default)', () => {
    expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false, altKey: false })).toBe('fly');
  });

  it('maps right-button drag to orbit in 2D', () => {
    expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false, altKey: false }, '2d')).toBe('orbit');
  });

  it('maps modified left-button drag to orbit', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: true, shiftKey: false, altKey: false })).toBe('orbit');
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: true, altKey: false })).toBe('orbit');
  });
});

describe('computeGroundPanOffset', () => {
  it('moves the camera opposite to cursor travel so content follows the drag', () => {
    expect(computeGroundPanOffset({ x: 10, y: 5 }, { x: 14, y: 9 })).toEqual({ x: -4, y: -4 });
  });

  it('returns null when a ground intersection is unavailable', () => {
    expect(computeGroundPanOffset(null, { x: 14, y: 9 })).toBeNull();
    expect(computeGroundPanOffset({ x: 10, y: 5 }, null)).toBeNull();
  });
});

describe('ViewportRenderer pixel ratio', () => {
  beforeEach(() => vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16 }));
  afterEach(() => vi.unstubAllGlobals());

  /** Renderer with just enough fake GPU state for resize(). */
  function makeRenderer() {
    const renderer = new ViewportRenderer();
    const canvas = { width: 0, height: 0 };
    const device = { createTexture: vi.fn(() => ({ destroy: vi.fn() })) };
    Object.assign(renderer as unknown as Record<string, unknown>, { device, context: { canvas } });
    return { renderer, canvas, device };
  }

  it('sizes the canvas and depth target in device pixels', () => {
    const { renderer, canvas, device } = makeRenderer();
    renderer.setPixelRatio(2);
    renderer.resize(300, 150);

    expect(canvas).toEqual({ width: 600, height: 300 });
    expect(device.createTexture).toHaveBeenLastCalledWith(expect.objectContaining({ size: [600, 300] }));
  });

  it('keeps projection in CSS px', () => {
    const { renderer } = makeRenderer();
    renderer.resize(300, 150);
    const before = renderer.projectWorldToScreen(0, 0, 0);
    renderer.setPixelRatio(2);

    expect(renderer.projectWorldToScreen(0, 0, 0)).toEqual(before);
  });

  it('reports the line-width scale per device pixel, including on ratio changes', () => {
    const { renderer } = makeRenderer();
    renderer.resize(300, 150);
    const cssMpp = renderer.getLineMetersPerPixel();
    const cb = vi.fn();
    renderer.setLineWidthScaleCallback(cb);

    renderer.setPixelRatio(2);

    expect(renderer.getLineMetersPerPixel()).toBeCloseTo(cssMpp / 2, 12);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ mpp: renderer.getLineMetersPerPixel() }));
  });

  describe('with Gaussian splats', () => {
    type Internals = Record<string, unknown>;
    const asInternals = (r: ViewportRenderer) => r as unknown as Internals;

    it('renders at 1x while scene splats are visible and restores the ratio afterwards', () => {
      const { renderer, canvas } = makeRenderer();
      renderer.resize(300, 150);
      renderer.setPixelRatio(2);
      expect(canvas.width).toBe(600);

      asInternals(renderer).splatRenderer = { hasContent: true };
      renderer.setPixelRatio(2); // re-evaluates the effective ratio
      expect(renderer.getPixelRatio()).toBe(1);
      expect(canvas).toEqual({ width: 300, height: 150 });

      asInternals(renderer).splatRenderer = null;
      renderer.setPixelRatio(2);
      expect(renderer.getPixelRatio()).toBe(2);
      expect(canvas.width).toBe(600);
    });

    it('stays at the requested ratio when the scene splats are hidden', () => {
      const { renderer } = makeRenderer();
      renderer.resize(300, 150);
      asInternals(renderer).splatRenderer = { hasContent: true };
      renderer.setSceneSplatsVisible(false);
      renderer.setPixelRatio(2);

      expect(renderer.getPixelRatio()).toBe(2);
    });

    it.each(['actorSplatRenderer', 'actorSplatInstancer'])('%s content also forces 1x', (field) => {
      const { renderer } = makeRenderer();
      renderer.resize(300, 150);
      asInternals(renderer)[field] = { hasContent: true };
      renderer.setPixelRatio(2);

      expect(renderer.getPixelRatio()).toBe(1);
    });
  });
});

describe('ViewportRenderer.render() frame stats', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports FPS for host-driven frames that bypass the render loop', () => {
    const renderer = new ViewportRenderer();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      device: {},
      renderFrame: vi.fn(),
    });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    for (let i = 0; i < 40; i++, now += 20) renderer.render();

    expect(renderer.getRenderStats().fps).toBeCloseTo(50, 0);
    expect(renderer.getRenderStats().lastRenderTs).toBeGreaterThan(0);
  });
});
