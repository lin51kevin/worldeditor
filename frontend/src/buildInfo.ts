/**
 * Build-time information injected by Vite's `define` plugin.
 * Values are replaced at compile time — safe for tree-shaking.
 */

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;
declare const __GIT_BRANCH__: string;

export interface BuildInfo {
  /** Semantic version from package.json (e.g. "0.2.0") */
  version: string;
  /** ISO 8601 build timestamp (e.g. "2026-05-26T07:00:00.000Z") */
  buildTime: string;
  /** Short git commit hash (e.g. "a1b2c3d") */
  gitCommit: string;
  /** Git branch name (e.g. "main") */
  gitBranch: string;
}

export const buildInfo: BuildInfo = {
  version: __APP_VERSION__,
  buildTime: __BUILD_TIME__,
  gitCommit: __GIT_COMMIT__,
  gitBranch: __GIT_BRANCH__,
};
