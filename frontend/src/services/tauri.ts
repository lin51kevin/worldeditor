/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC for file I/O.
 * Geometry/rendering operations delegate to WASM via BasePlatformService.
 */

import type { PlatformService, Project } from './platform';
import { APP_VERSION } from './index';
import { BasePlatformService } from './basePlatformService';

export class TauriPlatformService extends BasePlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('parse_opendrive', { xml });
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('write_opendrive', { project });
  }

  async openFile(): Promise<{ name: string; content: string } | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await open({
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr', 'xml'] }],
    });

    if (!path) return null;

    const content = await readTextFile(path);
    const name = path.split(/[/\\]/).pop() ?? 'untitled';
    return { name, content };
  }

  async saveFile(filename: string, content: string): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr'] }],
    });

    if (path) {
      await writeTextFile(path, content);
    }
  }

  getPlatformInfo() {
    return { type: 'tauri' as const, version: APP_VERSION };
  }
}
