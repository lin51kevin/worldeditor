/**
 * External plugin SDK — shared typings for filesystem plugins authored in this repo.
 *
 * External plugins are bundled (esbuild → IIFE) into `plugins/<id>/dist/index.js`
 * and loaded at runtime via `window.__WE_PLUGIN_API__`. They must NOT statically
 * import app runtime modules (stores, Tauri, platform) — the sandbox guard rejects
 * platform capabilities. All host access goes through the {@link PluginContext}.
 *
 * Type-only imports below are erased at build time, so they add no runtime coupling.
 */

import type { PluginContext } from '../plugins/core/pluginApi';
import type { PluginPermission } from '../plugins/core/pluginApi';
import type { PluginCodec, CodecFormat, PluginGis, GeoCoord, UtmCoord, EcefCoord } from '../plugins/core/pluginApi';

export type { PluginContext, PluginPermission, PluginCodec, CodecFormat, PluginGis, GeoCoord, UtmCoord, EcefCoord };

/** Setup callback invoked when a plugin registers; may return a cleanup function. */
export type PluginSetup = (ctx: PluginContext) => (() => void) | void;

/** The global plugin API installed on `window` by the host before a bundle runs. */
export interface WePluginApi {
  registerPlugin(id: string, setup: PluginSetup, permissions?: readonly PluginPermission[]): void;
  unloadPlugin(id: string): void;
}

declare global {
  interface Window {
    __WE_PLUGIN_API__?: WePluginApi;
  }
}

/**
 * Retrieve the host plugin API. Throws if the bundle is executed outside the
 * host (which pre-installs the API before injecting any plugin script).
 */
export function getPluginApi(): WePluginApi {
  const api = window.__WE_PLUGIN_API__;
  if (!api) {
    throw new Error('WorldEditor plugin API is not available in this context');
  }
  return api;
}
