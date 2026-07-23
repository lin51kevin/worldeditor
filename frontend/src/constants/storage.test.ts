import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS, getStorageItem, setStorageItem } from './storage';

describe('storage constants', () => {
  it('exports prefixed keys', () => {
    expect(STORAGE_KEYS.THEME).toBe('we-theme');
    expect(STORAGE_KEYS.PANEL_LEFT).toBe('we-panel-left');
  });
});

describe('getStorageItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the parsed stored value', () => {
    localStorage.setItem(STORAGE_KEYS.THEME, JSON.stringify('dark'));
    expect(getStorageItem(STORAGE_KEYS.THEME, 'light')).toBe('dark');
  });

  it('returns the default when key is missing', () => {
    expect(getStorageItem(STORAGE_KEYS.THEME, 'light')).toBe('light');
  });

  it('returns the default when stored value is not valid JSON', () => {
    localStorage.setItem(STORAGE_KEYS.THEME, 'not-json{');
    expect(getStorageItem(STORAGE_KEYS.THEME, 'fallback')).toBe('fallback');
  });
});

describe('setStorageItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores a JSON-serialized value', () => {
    setStorageItem(STORAGE_KEYS.THEME, 'dark');
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe('"dark"');
  });

  it('does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => setStorageItem(STORAGE_KEYS.THEME, 'dark')).not.toThrow();
    vi.restoreAllMocks();
  });
});
