/**
 * Shared runtime platform detection.
 *
 * Single source of truth for checking whether the app is running inside
 * the Tauri desktop shell vs a plain web browser. Import this instead of
 * inlining the `__TAURI_INTERNALS__` check in every module.
 */

/** True when running inside the Tauri desktop shell. */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True when running in a web browser (non-Tauri). */
export function isWebRuntime(): boolean {
  return !isDesktopRuntime();
}
