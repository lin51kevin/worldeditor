import { describe, it, expect, vi } from 'vitest';
import { setupMouseControls } from './mouseControls';

describe('mouseControls', () => {
  function createMockCanvas() {
    const listeners: Record<string, EventListener[]> = {};
    const canvas = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((h) => h !== handler);
        }
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      style: { cursor: '' },
      _listeners: listeners,
    } as unknown as HTMLCanvasElement & { _listeners: typeof listeners };
    return canvas;
  }

  function createMockDeps() {
    return {
      cameraController: {
        pointerDragging: false,
        beginPointerDrag: vi.fn(() => false),
        updatePointerDrag: vi.fn(() => true),
        endPointerDrag: vi.fn(),
        handleWheel: vi.fn(),
        lock: vi.fn(),
        unlock: vi.fn(),
      } as never,
      markerRenderer: {
        knotCount: 0,
        knots: [],
        tangentOverrides: {},
        hovered: null,
        setTangentOverrides: vi.fn(),
        refreshSplineCurve: vi.fn(),
        refreshSplineMarkers: vi.fn(),
      } as never,
      callbacks: {
        onTangentChanged: null,
        onControlPointHovered: null,
        onControlPointSelected: null,
      },
      pickControlPointAtScreen: vi.fn(() => null),
      unprojectToGround: vi.fn(() => ({ x: 0, y: 0 })),
      getMetersPerPixel: vi.fn(() => 1.0),
      refreshSplineMarkers: vi.fn(),
      markSceneDirty: vi.fn(),
      clearColor: [0.1, 0.1, 0.12] as [number, number, number],
    };
  }

  it('should attach 4 event listeners on setup', () => {
    const canvas = createMockCanvas();
    const deps = createMockDeps();

    setupMouseControls(canvas, deps);

    // mousemove, mousedown, wheel, contextmenu
    expect(canvas.addEventListener).toHaveBeenCalledTimes(4);
    expect(canvas.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(canvas.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(canvas.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    expect(canvas.addEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function));
  });

  it('should remove all listeners on dispose', () => {
    const canvas = createMockCanvas();
    const deps = createMockDeps();

    const dispose = setupMouseControls(canvas, deps);
    dispose();

    expect(canvas.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function));
  });

  it('should not process mousemove when knotCount is 0', () => {
    const canvas = createMockCanvas();
    const deps = createMockDeps();
    deps.markerRenderer.knotCount = 0;

    setupMouseControls(canvas, deps);

    // Trigger mousemove
    const handler = canvas._listeners['mousemove']?.[0];
    if (handler) {
      handler(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    }

    expect(deps.pickControlPointAtScreen).not.toHaveBeenCalled();
  });

  it('should call pickControlPointAtScreen when knots exist', () => {
    const canvas = createMockCanvas();
    const deps = createMockDeps();
    (deps.markerRenderer as { knotCount: number }).knotCount = 3;

    setupMouseControls(canvas, deps);

    const handler = canvas._listeners['mousemove']?.[0];
    if (handler) {
      handler(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    }

    expect(deps.pickControlPointAtScreen).toHaveBeenCalledWith(100, 100);
  });
});
