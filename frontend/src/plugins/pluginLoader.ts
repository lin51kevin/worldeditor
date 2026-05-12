/**
 * Plugin loader — dynamically executes external plugin JS bundles in the browser.
 *
 * Each plugin bundle is an IIFE that calls `window.__WE_PLUGIN_API__.registerPlugin(...)`.
 * The JS content is received from the backend and executed via a Blob URL <script> element.
 */

import { installPluginApi, unloadExternalPlugin } from './pluginApi';

/** Maps plugin ID → injected <script> element */
const loadedScripts = new Map<string, HTMLScriptElement>();

/**
 * Execute a plugin's JS bundle in the current browser context.
 * Calling this with an already-loaded ID unloads the previous instance first.
 */
export async function loadPluginBundle(id: string, jsContent: string): Promise<void> {
  // Ensure the global API is available before any plugin script runs
  installPluginApi();

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
