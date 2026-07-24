/**
 * Shared runtime — exposes host singletons to external plugins on `window`.
 *
 * UI plugins built as sandboxed IIFE bundles cannot bundle their own copy of
 * React (hooks/context require the SAME instance as the host). The build step
 * (scripts/build-plugins.mjs) rewrites `react` / `react/jsx-runtime` imports to
 * read from `window.__WE_SHARED__`, which this module populates BEFORE any
 * external plugin bundle executes.
 */

import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import i18n from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { usePluginContribStore } from '../../stores/pluginContribStore';

/**
 * Host singletons exposed to TRUSTED (first-party) external plugins.
 *
 * These grant near-app-level capability (store access), so they are only
 * usable by first-party bundled plugins — the build step rewrites store/i18n
 * imports to these globals ONLY for trusted plugins, and third-party sandboxed
 * plugins never receive store access (the sandbox guard forbids it).
 */
interface WeShared {
  react: typeof React;
  reactJsxRuntime: typeof ReactJsxRuntime;
  i18n: typeof i18n;
  stores: {
    useProjectStore: typeof useProjectStore;
    useViewportStore: typeof useViewportStore;
    usePluginContribStore: typeof usePluginContribStore;
  };
}

/** Install the shared runtime globals (idempotent). */
export function installSharedRuntime(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __WE_SHARED__?: WeShared };
  if (w.__WE_SHARED__) return;
  w.__WE_SHARED__ = {
    react: React,
    reactJsxRuntime: ReactJsxRuntime,
    i18n,
    stores: { useProjectStore, useViewportStore, usePluginContribStore },
  };
}
