import { describe, expect, it } from 'vitest';
import { isDesktopRuntime, isWebRuntime } from './platformDetect';

describe('platformDetect', () => {
  it('isDesktopRuntime returns false in jsdom (no __TAURI_INTERNALS__)', () => {
    expect(isDesktopRuntime()).toBe(false);
  });

  it('isWebRuntime returns true in jsdom (not Tauri)', () => {
    expect(isWebRuntime()).toBe(true);
  });
});
