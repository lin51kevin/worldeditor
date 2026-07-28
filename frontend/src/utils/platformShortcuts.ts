/**
 * Runtime-aware remapping for shortcuts that collide with UNPREVENTABLE
 * browser shortcuts in the web build.
 *
 * `Ctrl+W` (close tab), `Ctrl+N` (new window) and `Ctrl+T` (new tab) are
 * reserved by the browser chrome and cannot be intercepted with
 * `preventDefault()`. In the web build we therefore expose them through the
 * `Ctrl+Alt+*` family (which the page *is* allowed to cancel). The Tauri
 * desktop shell has no browser chrome, so it keeps the native combos that
 * desktop users expect.
 *
 * Both the keydown matchers and the human-readable labels live here so the
 * behaviour and the hints shown in menus / help stay in sync.
 */

/** True when running inside the Tauri desktop shell. */
function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const SHORTCUTS = {
  newProject: { desktop: 'Ctrl+N', web: 'Ctrl+Alt+N' },
  closeFile: { desktop: 'Ctrl+W', web: 'Ctrl+Alt+W' },
  toggleToolbar: { desktop: 'Ctrl+T', web: 'Ctrl+Alt+B' },
} as const;

export type RemappedAction = keyof typeof SHORTCUTS;

/** Display label for the given action in the current runtime. */
export function shortcutLabel(action: RemappedAction): string {
  return isDesktopRuntime() ? SHORTCUTS[action].desktop : SHORTCUTS[action].web;
}

function hasCtrl(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/**
 * Match a physical letter key regardless of keyboard layout. On Windows
 * `Ctrl+Alt` is delivered as AltGr, under which `event.key` for a letter can
 * become a composed/dead character — so prefer `event.code` (e.g. 'KeyW') and
 * fall back to `event.key` (which unit tests dispatch without a code).
 */
function hasLetter(e: KeyboardEvent, letter: string): boolean {
  return e.code === `Key${letter.toUpperCase()}` || e.key.toLowerCase() === letter;
}

/** Web requires the extra Alt modifier; desktop must NOT have Alt held. */
function altMatchesRuntime(e: KeyboardEvent): boolean {
  return isDesktopRuntime() ? !e.altKey : e.altKey;
}

/** `Ctrl+N` (desktop) / `Ctrl+Alt+N` (web) — new project. */
export function matchesNewProject(e: KeyboardEvent): boolean {
  return hasCtrl(e) && !e.shiftKey && hasLetter(e, 'n') && altMatchesRuntime(e);
}

/** `Ctrl+W` (desktop) / `Ctrl+Alt+W` (web) — close file. */
export function matchesCloseFile(e: KeyboardEvent): boolean {
  return hasCtrl(e) && !e.shiftKey && hasLetter(e, 'w') && altMatchesRuntime(e);
}

/** `Ctrl+T` (desktop) / `Ctrl+Alt+B` (web) — toggle floating toolbar. */
export function matchesToggleToolbar(e: KeyboardEvent): boolean {
  if (!hasCtrl(e) || e.shiftKey) return false;
  return isDesktopRuntime()
    ? !e.altKey && hasLetter(e, 't')
    : e.altKey && hasLetter(e, 'b');
}
