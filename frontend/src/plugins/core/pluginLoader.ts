/**
 * Plugin loader — dynamically executes external plugin JS bundles in the browser.
 *
 * Each plugin bundle is an IIFE that calls `window.__WE_PLUGIN_API__.registerPlugin(...)`.
 * The JS content is received from the backend and executed via a Blob URL <script> element.
 *
 * Plugins must provide a valid manifest with declared permissions. The loader validates
 * the manifest before execution and rejects plugins with invalid or missing fields.
 */

import { installPluginApi, unloadExternalPlugin, setManifestPermissions, type PluginPermission, ALL_PERMISSIONS } from './pluginApi';
import { assertPluginSourceSafe } from './sandboxGuard';

// ── Manifest schema ───────────────────────────────────────────────────────────

/** Plugin manifest format (must match `manifest.json` in the plugin directory). */
export interface PluginManifest {
  /** Unique plugin ID (kebab-case). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semver version string (e.g. "1.0.0"). */
  version: string;
  /** Plugin entry point relative to the plugin directory. */
  main: string;
  /** Optional description. */
  description?: string;
  /** Plugin author. */
  author?: string;
  /** SPDX license identifier. */
  license?: string;
  /** IDs of plugins this plugin depends on. */
  dependencies?: string[];
  /** Permissions this plugin requests (see PluginPermission). */
  permissions?: PluginPermission[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validate a plugin manifest. Returns an error message or `null` if valid. */
export function validateManifest(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return 'Manifest must be a JSON object';
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== 'string' || !KEBAB_RE.test(m.id)) return `Invalid plugin id: must be kebab-case`;
  if (typeof m.name !== 'string' || m.name.length === 0) return 'Missing plugin name';
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) return `Invalid version '${m.version}': must be X.Y.Z`;
  if (typeof m.main !== 'string' || m.main.length === 0) return 'Missing entry point (main)';
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) return 'permissions must be an array';
    for (const p of m.permissions) {
      if (!(ALL_PERMISSIONS as readonly string[]).includes(p as string)) {
        return `Unknown permission: '${p}'`;
      }
    }
  }
  return null;
}

/** Maps plugin ID → injected <script> element */
const loadedScripts = new Map<string, HTMLScriptElement>();

/**
 * Execute a plugin's JS bundle in the current browser context.
 * Calling this with an already-loaded ID unloads the previous instance first.
 *
 * @param id        Unique plugin identifier.
 * @param jsContent The plugin IIFE JavaScript source code.
 * @param manifest  Optional manifest — when provided, permissions are validated
 *                  and enforced. Without a manifest, ALL permissions are granted
 *                  (backward-compatible for built-in plugins).
 */
export async function loadPluginBundle(id: string, jsContent: string, manifest?: PluginManifest): Promise<void> {
  // Validate manifest if provided
  if (manifest) {
    const error = validateManifest(manifest);
    if (error) throw new Error(`Invalid manifest for plugin '${id}': ${error}`);
    if (manifest.id !== id) throw new Error(`Manifest id '${manifest.id}' does not match plugin id '${id}'`);
    // Security: external (manifest-bearing, untrusted) bundles are statically
    // scanned for forbidden platform capabilities before they are ever injected.
    // Built-in plugins (loaded without a manifest) are trusted and skip this.
    assertPluginSourceSafe(id, jsContent);
  }
  // Ensure the global API is available before any plugin script runs
  installPluginApi();

  // Security: pre-register manifest permissions BEFORE the bundle executes.
  // registerPlugin() will consume this entry and use it as the authoritative
  // permission set — ignoring whatever the bundle claims at runtime.
  const grantedPermissions: readonly PluginPermission[] = manifest?.permissions ?? ALL_PERMISSIONS;
  setManifestPermissions(id, grantedPermissions);

  // Unload previous instance if reloading
  if (loadedScripts.has(id)) {
    unloadPluginBundle(id);
  }

  const blob = new Blob([jsContent], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to execute plugin bundle: ${id}`));
    };
    document.head.appendChild(script);
    loadedScripts.set(id, script);
  });
}

/**
 * Unload an external plugin: run its cleanup and remove the <script> element.
 */
export function unloadPluginBundle(id: string): void {
  unloadExternalPlugin(id);
  const script = loadedScripts.get(id);
  if (script?.parentNode) {
    script.parentNode.removeChild(script);
    loadedScripts.delete(id);
  }
}
