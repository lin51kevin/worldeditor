import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { savePrefs, loadPrefs, saveLayout, loadLayout, saveDisplay, loadDisplay, clamp } from './persistence';

describe('viewport persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('clamp', () => {
    it('clamps value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('savePrefs / loadPrefs', () => {
    it('stores prefs in localStorage after debounce', () => {
      savePrefs({ showGrid: true });
      expect(localStorage.getItem('we-user-prefs')).toBeNull();
      vi.advanceTimersByTime(150);
      const stored = JSON.parse(localStorage.getItem('we-user-prefs')!);
      expect(stored.showGrid).toBe(true);
    });

    it('merges with existing prefs', () => {
      localStorage.setItem('we-user-prefs', JSON.stringify({ showGrid: true }));
      savePrefs({ showAxis: true });
      vi.advanceTimersByTime(150);
      const stored = JSON.parse(localStorage.getItem('we-user-prefs')!);
      expect(stored.showGrid).toBe(true);
      expect(stored.showAxis).toBe(true);
    });

    it('loadPrefs returns stored preferences', () => {
      localStorage.setItem('we-user-prefs', JSON.stringify({ showGrid: false }));
      expect(loadPrefs()).toEqual({ showGrid: false });
    });

    it('loadPrefs returns empty object when nothing stored', () => {
      expect(loadPrefs()).toEqual({});
    });

    it('loadPrefs returns empty object on corrupted data', () => {
      localStorage.setItem('we-user-prefs', '{not-valid');
      expect(loadPrefs()).toEqual({});
    });

    it('savePrefs handles localStorage errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      savePrefs({ showGrid: true });
      vi.advanceTimersByTime(150);
      vi.restoreAllMocks();
    });
  });

  describe('saveLayout / loadLayout', () => {
    it('saves and loads layout', () => {
      const layout = { leftPanelOpen: true, rightPanelOpen: false, leftPanelWidth: 300, rightPanelWidth: 250 };
      saveLayout(layout as any);
      const loaded = loadLayout();
      expect(loaded.leftPanelOpen).toBe(true);
    });

    it('returns defaults on corrupted data', () => {
      localStorage.setItem('we-editor-view', 'corrupt{');
      const loaded = loadLayout();
      expect(loaded).toBeDefined();
    });

    it('handles save errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => saveLayout({} as any)).not.toThrow();
      vi.restoreAllMocks();
    });
  });

  describe('saveDisplay / loadDisplay', () => {
    it('saves and loads display settings after debounce', () => {
      const display = { showGrid: true, showAxis: true };
      saveDisplay(display as any);
      vi.advanceTimersByTime(150);
      const loaded = loadDisplay();
      expect(loaded.showGrid).toBe(true);
    });

    it('returns defaults on corrupted data', () => {
      localStorage.setItem('we-display-settings', '!!!');
      const loaded = loadDisplay();
      expect(loaded).toBeDefined();
    });

    it('handles save errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      saveDisplay({} as any);
      vi.advanceTimersByTime(150);
      vi.restoreAllMocks();
    });
  });
});
