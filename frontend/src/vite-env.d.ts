/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * When set to `'true'`, beta/experimental built-in plugins remain visible
   * even in production builds. Beta plugins are hidden by default in production.
   */
  readonly VITE_SHOW_BETA_PLUGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
