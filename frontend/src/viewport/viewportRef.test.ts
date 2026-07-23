import { describe, it, expect } from 'vitest';
import { setViewportRenderer, getViewportRenderer } from './viewportRef';

describe('viewportRef', () => {
  it('initially returns null', () => {
    setViewportRenderer(null);
    expect(getViewportRenderer()).toBeNull();
  });

  it('stores and retrieves the renderer reference', () => {
    const fake = { render: () => {} } as any;
    setViewportRenderer(fake);
    expect(getViewportRenderer()).toBe(fake);
    // cleanup
    setViewportRenderer(null);
  });

  it('clears the renderer when set to null', () => {
    const fake = { render: () => {} } as any;
    setViewportRenderer(fake);
    setViewportRenderer(null);
    expect(getViewportRenderer()).toBeNull();
  });
});
