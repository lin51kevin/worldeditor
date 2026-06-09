/**
 * Version-check & self-update service.
 *
 * On the desktop (Tauri) build this drives `tauri-plugin-updater` to download,
 * verify (minisign signature) and install signed updates, then relaunches the
 * app via `tauri-plugin-process`.
 *
 * On the web build (or whenever the updater is unavailable) it falls back to a
 * lightweight GitHub Releases check that only informs the user that a newer
 * version is available and provides a download link.
 */
import { APP_VERSION } from './index';

const GITHUB_API =
  'https://api.github.com/repos/lin51kevin/worldeditor/releases/latest';

export interface UpdateInfo {
  /** The latest version tag without leading "v", e.g. "0.2.0" */
  latestVersion: string;
  /** HTML URL to the release page */
  releaseUrl: string;
  /** Release notes body */
  releaseNotes: string;
}

/** Compare two semver-ish version strings like "0.2.0" vs "0.1.1". */
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10));
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

/**
 * Check GitHub Releases for a newer version.
 *
 * Resolves with `UpdateInfo` when a newer version is available.
 * Resolves with `null` when already up-to-date or when the check fails
 * (network errors are swallowed — this is a non-critical background task).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(GITHUB_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      tag_name: string;
      html_url: string;
      body: string;
    };

    const latestVersion = data.tag_name.replace(/^v/, '');
    if (!isNewer(latestVersion, APP_VERSION)) return null;

    return {
      latestVersion,
      releaseUrl: data.html_url,
      releaseNotes: data.body ?? '',
    };
  } catch {
    // Network errors, CORS, timeouts — silently ignore
    return null;
  }
}

/** True when running inside the Tauri desktop shell. */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Minimal shape of the Tauri updater `Update` handle that the UI relies on.
 * Declared locally so the module type-checks even where the plugin types are
 * not in scope, while still matching `@tauri-apps/plugin-updater`.
 */
export interface DesktopUpdate {
  /** The available version, e.g. "0.4.0". */
  readonly version: string;
  /** The currently installed version. */
  readonly currentVersion: string;
  /** Release notes, when published in the update manifest. */
  readonly body?: string;
  /** Download, verify and install the update. */
  downloadAndInstall(): Promise<void>;
}

/**
 * Check for a signed desktop update via `tauri-plugin-updater`.
 *
 * Resolves with a `DesktopUpdate` handle when an update is available, or `null`
 * when the app is already up-to-date. Throws on transport/verification errors
 * so the caller can surface a failure message.
 */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  return (update as DesktopUpdate | null) ?? null;
}

/**
 * Download + install the given desktop update, then relaunch the app.
 *
 * The signature is verified against the embedded public key by the updater
 * plugin before installation; a tampered payload aborts with an error.
 */
export async function installDesktopUpdate(update: DesktopUpdate): Promise<void> {
  await update.downloadAndInstall();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
