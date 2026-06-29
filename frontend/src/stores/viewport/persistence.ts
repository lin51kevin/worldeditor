import type { SnapType } from '../../services/platform';
import { STORAGE_KEYS } from '../../constants/storage';
import type {
  PanelLayout,
  DisplaySettings,
  ViewDimension,
  SelectionMode,
} from './types';
import { DEFAULT_LAYOUT, DEFAULT_DISPLAY } from './types';

const LAYOUT_STORAGE_KEY = STORAGE_KEYS.EDITOR_VIEW;
const DISPLAY_STORAGE_KEY = STORAGE_KEYS.DISPLAY_SETTINGS;
const PREFS_STORAGE_KEY = STORAGE_KEYS.USER_PREFERENCES;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function saveLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch (e) {
    console.warn('[ViewportStore] Failed to save layout:', e);
  }
}

export function loadLayout(): PanelLayout {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PanelLayout>;
      return { ...DEFAULT_LAYOUT, ...parsed };
    }
  } catch (e) {
    console.warn('[ViewportStore] Failed to load layout, using defaults:', e);
  }
  return DEFAULT_LAYOUT;
}

let displayPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function saveDisplay(display: DisplaySettings): void {
  if (displayPersistTimer) clearTimeout(displayPersistTimer);
  displayPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
    } catch (e) {
      console.warn('[ViewportStore] Failed to save display settings:', e);
    }
  }, 100);
}

export function loadDisplay(): DisplaySettings {
  try {
    const saved = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<DisplaySettings>;
      return { ...DEFAULT_DISPLAY, ...parsed };
    }
  } catch (e) {
    console.warn('[ViewportStore] Failed to load display settings, using defaults:', e);
  }
  return DEFAULT_DISPLAY;
}

export interface UserPreferences {
  showGrid?: boolean;
  showAxis?: boolean;
  snapEnabled?: boolean;
  snapMode?: SnapType;
  snapThreshold?: number;
  gridSnapSize?: number;
  snapToEndpoints?: boolean;
  snapToMidpoints?: boolean;
  snapToPerpendicular?: boolean;
  snapToGrid?: boolean;
  snapToLaneEndpoints?: boolean;
  dimension?: ViewDimension;
  viewMode?: 'sketch' | 'wire' | 'solid';
  selectionMode?: SelectionMode;
}

let prefsPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function savePrefs(prefs: UserPreferences): void {
  if (prefsPersistTimer) clearTimeout(prefsPersistTimer);
  prefsPersistTimer = setTimeout(() => {
    try {
      const existing = loadPrefs();
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...existing, ...prefs }));
    } catch (e) {
      console.warn('[ViewportStore] Failed to save user preferences:', e);
    }
  }, 100);
}

export function loadPrefs(): UserPreferences {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) return JSON.parse(saved) as UserPreferences;
  } catch (e) {
    console.warn('[ViewportStore] Failed to load user preferences:', e);
  }
  return {};
}
