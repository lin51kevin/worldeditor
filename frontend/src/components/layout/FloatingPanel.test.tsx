import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingPanel } from './FloatingPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanel(props?: Partial<React.ComponentProps<typeof FloatingPanel>>) {
  return (
    <FloatingPanel
      dragHandleSelector=".handle"
      defaultWidth={340}
      resizeEdges={['right', 'bottom']}
      storageKey={`test-fp-${Math.random()}`}
      {...props}
    >
      <div className="handle">Drag Me</div>
      <div>Content</div>
    </FloatingPanel>
  );
}

function getPanel(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement;
}

/** Returns the inline left/top values or null if not set. */
function getInlinePos(container: HTMLElement): { left: string; top: string } | null {
  const el = getPanel(container);
  const left = el?.style?.left ?? '';
  const top = el?.style?.top ?? '';
  if (!left && !top) return null;
  return { left, top };
}

// ---------------------------------------------------------------------------
// Default (non-centered) behaviour
// ---------------------------------------------------------------------------

describe('FloatingPanel — default state (no initialCenter)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('renders without inline left/top on first frame (CSS class controls position)', () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-default' })));
    });
    // Before useLayoutEffect fires in test env, rect is null → no inline left/top
    // After act(), the layout effect has run but getBoundingClientRect returns 0,0 in jsdom
    const pos = getInlinePos(container);
    // Either null (no saved state, jsdom rect = 0) or {left: '0px', top: '0px'}
    if (pos !== null) {
      expect(pos.left).toBe('0px');
      expect(pos.top).toBe('0px');
    }
  });

  it('restores saved x/y from localStorage (new format)', () => {
    localStorage.setItem('fp-saved-v2', JSON.stringify({ x: 50, y: 80, w: 340, h: 500, v: 2 }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-saved-v2' })));
    });
    const el = getPanel(container);
    expect(el.style.left).toBe('50px');
    expect(el.style.top).toBe('80px');
    expect(el.style.width).toBe('340px');
    expect(el.style.height).toBe('500px');
  });

  it('discards old tx/ty format (v1) and starts fresh', () => {
    localStorage.setItem('fp-old-v1', JSON.stringify({ tx: 50, ty: 80, width: 340, height: null, v: 1 }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-old-v1' })));
    });
    // Old format is discarded; rect is null on first render
    const el = getPanel(container);
    expect(el.style.left).not.toBe('50px');
  });

  it('persists new-format state to localStorage after render', () => {
    localStorage.setItem('fp-persist', JSON.stringify({ x: 10, y: 20, w: 340, h: 400, v: 2 }));
    act(() => {
      render(makePanel({ storageKey: 'fp-persist' }));
    });
    const saved = JSON.parse(localStorage.getItem('fp-persist')!);
    expect(saved).toMatchObject({ x: 10, y: 20, w: 340, h: 400, v: 2 });
  });
});

// ---------------------------------------------------------------------------
// initialCenter centering behaviour
// ---------------------------------------------------------------------------

describe('FloatingPanel — initialCenter', () => {
  const VIEWPORT_W = 1024;
  const VIEWPORT_H = 768;
  const PANEL_W = 340;
  const PANEL_H = 400;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth',  { value: VIEWPORT_W, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: VIEWPORT_H, configurable: true, writable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: PANEL_W, height: PANEL_H,
      top: 0, left: 0, right: PANEL_W, bottom: PANEL_H,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('centers panel in viewport when no saved state', () => {
    const expectedX = Math.round((VIEWPORT_W - PANEL_W) / 2);
    const expectedY = Math.round((VIEWPORT_H - PANEL_H) / 2);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-new', initialCenter: true })));
    });
    const el = getPanel(container);
    expect(el.style.left).toBe(`${expectedX}px`);
    expect(el.style.top).toBe(`${expectedY}px`);
  });

  it('uses valid saved state (v:2) instead of re-centering', () => {
    localStorage.setItem('fp-center-saved', JSON.stringify({ x: 100, y: 200, w: 340, h: 500, v: 2 }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-saved', initialCenter: true })));
    });
    const el = getPanel(container);
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('200px');
  });

  it('discards stale saved state (old tx/ty format) and re-centers', () => {
    localStorage.setItem('fp-center-stale', JSON.stringify({ tx: 800, ty: 50, width: 340, height: null, v: 1 }));
    const expectedX = Math.round((VIEWPORT_W - PANEL_W) / 2);
    const expectedY = Math.round((VIEWPORT_H - PANEL_H) / 2);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-stale', initialCenter: true })));
    });
    const el = getPanel(container);
    expect(el.style.left).toBe(`${expectedX}px`);
    expect(el.style.top).toBe(`${expectedY}px`);
  });

  it('applies initialCenterOffset to the centered position', () => {
    const expectedX = Math.round((VIEWPORT_W - PANEL_W) / 2) + 20;
    const expectedY = Math.round((VIEWPORT_H - PANEL_H) / 2) + 30;

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({
        storageKey: 'fp-center-offset',
        initialCenter: true,
        initialCenterOffset: { x: 20, y: 30 },
      })));
    });
    const el = getPanel(container);
    expect(el.style.left).toBe(`${expectedX}px`);
    expect(el.style.top).toBe(`${expectedY}px`);
  });

  it('writes v:2 to localStorage after first render', () => {
    act(() => {
      render(makePanel({ storageKey: 'fp-center-persist', initialCenter: true }));
    });
    const saved = JSON.parse(localStorage.getItem('fp-center-persist')!);
    expect(saved.v).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Resize handles
// ---------------------------------------------------------------------------

describe('FloatingPanel — resize handles', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('renders 2 edge + 1 corner handle for resizeEdges=[right, bottom]', () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-handles-rb', resizeEdges: ['right', 'bottom'] })));
    });
    const handles = container.querySelectorAll('.fp-resize-handle');
    // r, b edges + rb corner = 3
    expect(handles.length).toBe(3);
    expect(container.querySelector('.fp-resize-right')).toBeTruthy();
    expect(container.querySelector('.fp-resize-bottom')).toBeTruthy();
    expect(container.querySelector('.fp-resize-corner-br')).toBeTruthy();
  });

  it('renders 8 handles for resizeEdges=[top, right, bottom, left]', () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({
        storageKey: 'fp-handles-all',
        resizeEdges: ['top', 'right', 'bottom', 'left'],
      })));
    });
    const handles = container.querySelectorAll('.fp-resize-handle');
    // 4 edges + 4 corners = 8
    expect(handles.length).toBe(8);
    expect(container.querySelector('.fp-resize-corner-br')).toBeTruthy();
    expect(container.querySelector('.fp-resize-corner-lb')).toBeTruthy();
    expect(container.querySelector('.fp-resize-corner-rt')).toBeTruthy();
    expect(container.querySelector('.fp-resize-corner-lt')).toBeTruthy();
  });
});
