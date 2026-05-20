/**
 * Centralized storage keys for localStorage/sessionStorage.
 * All keys use 'we-' prefix to avoid conflicts with other applications.
 */

export const STORAGE_KEYS = {
  // Startup
  SHOW_WELCOME_ON_STARTUP: 'we-show-welcome-on-startup',

  // Panels
  PANEL_LEFT: 'we-panel-left',
  PANEL_RIGHT: 'we-panel-right',
  PANEL_TEMPLATE: 'we-panel-template',

  // Toolbar
  TOOLBAR_POS: 'we-toolbar-pos',

  // Theme
  THEME: 'we-theme',

  // Viewport
  EDITOR_VIEW: 'we-editor-view',
  DISPLAY_SETTINGS: 'we-display-settings',
  USER_PREFERENCES: 'we-user-prefs',

  // Events (read-only, not stored)
  LOG_EVENT: 'we-log',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Helper to get storage value with type safety.
 */
export function getStorageItem<T>(key: StorageKey, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Helper to set storage value with type safety.
 */
export function setStorageItem<T>(key: StorageKey, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save to localStorage: ${key}`, error);
  }
}
