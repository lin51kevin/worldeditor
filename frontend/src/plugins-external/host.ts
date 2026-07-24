/**
 * host — runtime accessor for the host's shared singletons (TRUSTED plugins only).
 *
 * First-party plugins that need reactive app state import stores/i18n from here
 * instead of the app tree directly. At runtime these resolve to the SAME
 * instances the host uses (via `window.__WE_SHARED__`, installed before any
 * plugin bundle runs). The esbuild build therefore never bundles the real
 * stores — it bundles only this thin indirection — and the plugin shares the
 * app's single store/i18n instance so hooks and subscriptions stay reactive.
 *
 * Types are erased `typeof import(...)` references, so no runtime coupling is
 * introduced by them. Only TRUSTED (bundled) plugins may use this module; the
 * sandbox guard forbids third-party plugins from touching the global object by
 * bracket access, and they never receive shared-runtime store references.
 */

type Shared = {
  react: unknown;
  reactJsxRuntime: unknown;
  i18n: typeof import('../i18n').default;
  stores: {
    useProjectStore: typeof import('../stores/projectStore').useProjectStore;
    useViewportStore: typeof import('../stores/viewportStore').useViewportStore;
    usePluginContribStore: typeof import('../stores/pluginContribStore').usePluginContribStore;
  };
};

function shared(): Shared {
  const s = (window as unknown as { __WE_SHARED__?: Shared }).__WE_SHARED__;
  if (!s) {
    throw new Error('WorldEditor shared runtime is not installed (trusted plugin loaded out of context)');
  }
  return s;
}

/** The host's project store hook (reactive, shares the app's single instance). */
export const useProjectStore = shared().stores.useProjectStore;
/** The host's viewport store hook. */
export const useViewportStore = shared().stores.useViewportStore;
/** The host's plugin-contribution store hook. */
export const usePluginContribStore = shared().stores.usePluginContribStore;
/** The host i18n instance. */
export const i18n = shared().i18n;
