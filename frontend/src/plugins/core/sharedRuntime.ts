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

interface WeShared {
  react: typeof React;
  reactJsxRuntime: typeof ReactJsxRuntime;
}

/** Install the shared runtime globals (idempotent). */
export function installSharedRuntime(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __WE_SHARED__?: WeShared };
  if (w.__WE_SHARED__) return;
  w.__WE_SHARED__ = { react: React, reactJsxRuntime: ReactJsxRuntime };
}
