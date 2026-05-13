/**
 * Lightweight version-check service.
 *
 * Fetches the latest GitHub Release and compares it against APP_VERSION.
 * No write access / code execution — only informs the user that a newer
 * version is available and provides a download link.
 *
 * TODO: [Phase 4] Replace with tauri-plugin-updater for automatic
 * installation once release signing keys are configured.
 */
import { APP_VERSION } from './index';

const GITHUB_API =
  'https://api.github.com/repos/worldeditor-dev/worldeditor-next/releases/latest';

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
