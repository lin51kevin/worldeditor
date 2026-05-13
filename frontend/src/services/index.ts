/**
 * Platform service factory.
 * Automatically selects Tauri or Web adapter based on runtime environment.
 */
import type { PlatformService } from './platform';

/** Application version — single source of truth for frontend version display. */
export const APP_VERSION = '0.1.1';

let instance: PlatformService | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getPlatformService(): Promise<PlatformService> {
  if (instance) return instance;

  if (isTauri()) {
    const { TauriPlatformService } = await import('./tauri');
    instance = new TauriPlatformService();
  } else {
    const { WebPlatformService } = await import('./web');
    instance = new WebPlatformService();
  }

  return instance;
}
