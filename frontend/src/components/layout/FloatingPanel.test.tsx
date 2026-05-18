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

function getTransform(container: HTMLElement): string {
  const el = container.firstChild as HTMLElement;
  return el?.style?.transform ?? '';
}

// ---------------------------------------------------------------------------
// Default (non-centered) behaviour
// ---------------------------------------------------------------------------

describe('FloatingPanel — default state (no initialCenter)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('renders with transform translate(0px, 0px) when no saved state', () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-default' })));
    });
    expect(getTransform(container)).toBe('translate(0px, 0px)');
  });

  it('restores saved tx/ty from localStorage', () => {
    localStorage.setItem('fp-saved', JSON.stringify({ tx: 50, ty: 80, width: 340, height: null }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-saved' })));
    });
    expect(getTransform(container)).toBe('translate(50px, 80px)');
  });

  it('persists state to localStorage after render', () => {
    act(() => {
      render(makePanel({ storageKey: 'fp-persist' }));
    });
    const saved = JSON.parse(localStorage.getItem('fp-persist')!);
    expect(saved).toMatchObject({ tx: 0, ty: 0, width: 340 });
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
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
    // Expected: tx = (1024-340)/2 = 342, ty = (768-400)/2 = 184
    const expectedTx = Math.round((VIEWPORT_W - PANEL_W) / 2);
    const expectedTy = Math.round((VIEWPORT_H - PANEL_H) / 2);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-new', initialCenter: true })));
    });
    expect(getTransform(container)).toBe(`translate(${expectedTx}px, ${expectedTy}px)`);
  });

  it('uses valid saved state (v matches) instead of re-centering', () => {
    localStorage.setItem('fp-center-saved', JSON.stringify({
      tx: 100, ty: 200, width: 340, height: null, v: 1,
    }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-saved', initialCenter: true })));
    });
    // Should use the saved tx/ty, not center
    expect(getTransform(container)).toBe('translate(100px, 200px)');
  });

  it('discards stale saved state (no v field) and re-centers', () => {
    // Simulates a state saved under the old CSS anchor (no v field)
    localStorage.setItem('fp-center-stale', JSON.stringify({
      tx: 800, ty: 50, width: 340, height: null,
    }));
    const expectedTx = Math.round((VIEWPORT_W - PANEL_W) / 2);
    const expectedTy = Math.round((VIEWPORT_H - PANEL_H) / 2);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-center-stale', initialCenter: true })));
    });
    // Should NOT use (800, 50) — should be centered
    expect(getTransform(container)).toBe(`translate(${expectedTx}px, ${expectedTy}px)`);
  });

  it('non-centered panel (initialCenter=false) still uses stale state as-is', () => {
    localStorage.setItem('fp-no-center-stale', JSON.stringify({
      tx: 800, ty: 50, width: 340, height: null,
    }));
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({ storageKey: 'fp-no-center-stale' /* no initialCenter */ })));
    });
    // Non-centered panels always trust saved state
    expect(getTransform(container)).toBe('translate(800px, 50px)');
  });

  it('applies initialCenterOffset to the centered position', () => {
    const expectedTx = Math.round((VIEWPORT_W - PANEL_W) / 2) + 20;
    const expectedTy = Math.round((VIEWPORT_H - PANEL_H) / 2) + 30;

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(makePanel({
        storageKey: 'fp-center-offset',
        initialCenter: true,
        initialCenterOffset: { x: 20, y: 30 },
      })));
    });
    expect(getTransform(container)).toBe(`translate(${expectedTx}px, ${expectedTy}px)`);
  });

  it('writes v: 1 to localStorage after first render', () => {
    act(() => {
      render(makePanel({ storageKey: 'fp-center-persist', initialCenter: true }));
    });
    const saved = JSON.parse(localStorage.getItem('fp-center-persist')!);
    expect(saved.v).toBe(1);
  });
});
