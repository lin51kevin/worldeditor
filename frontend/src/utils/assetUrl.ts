/**
 * Asset URL resolver.
 *
 * Static assets (textures, config) are bundled inside the frontend dist/ and
 * served directly by the Tauri webview (or a Vite dev server in development).
 * Simple relative URLs like `/assets/textures/...` work in all environments.
 *
 * This module provides a thin helper so that callers don't hardcode leading
 * slashes and can pass paths with or without them.
 */

/**
 * No-op initializer kept for backward compatibility.
 * Previously resolved Tauri resource protocol paths; no longer needed since
 * assets are embedded in the webview's served content.
 */
export async function initAssetResolver(): Promise<void> {
  // No-op — assets are served from dist/ in all environments.
}

/**
 * Get a URL for a static asset bundled in public/.
 *
 * @param relativePath - Path relative to public/, e.g. 'assets/textures/manifest.json'
 *                       or 'config/intents.json'. Leading slash is optional.
 *                       If the path is already an absolute URL, it is returned as-is.
 * @returns A URL string usable with fetch() or as img src.
 *
 * @example
 * getAssetUrl('assets/textures/manifest.json')  → '/assets/textures/manifest.json'
 * getAssetUrl('/config/intents.json')           → '/config/intents.json'
 */
export function getAssetUrl(relativePath: string): string {
  // Already a full URL — return as-is
  if (/^(?:https?|blob|data):/.test(relativePath)) {
    return relativePath;
  }

  const cleanPath = relativePath.replace(/^\//, '');
  return `/${cleanPath}`;
}
