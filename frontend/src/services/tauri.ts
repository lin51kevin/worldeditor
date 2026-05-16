/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC for file I/O.
 * Geometry/rendering operations delegate to WASM via BasePlatformService.
 */

import type { PlatformService, Project } from './platform';
import { APP_VERSION } from './index';
import { BasePlatformService } from './basePlatformService';

function normalizeDialogPath(value: string | string[] | null): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0]! : null;
  }
  return value;
}

export class TauriPlatformService extends BasePlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('parse_opendrive', { xml });
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('write_opendrive', { project });
  }

  async openFile(): Promise<{ name: string; content: string; path?: string } | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');

    const rawPath = await open({
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr', 'xml'] }],
    });
    const filePath = normalizeDialogPath(rawPath);

    if (!filePath) return null;

    try {
      const content = await readTextFile(filePath);
      const name = filePath.split(/[/\\]/).pop() ?? 'untitled';
      return { name, content, path: filePath };
    } catch (error) {
      throw new Error(`Failed to read selected file: ${String(error)}`);
    }
  }

  async openFileByPath(filePath: string): Promise<{ name: string; content: string } | null> {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(filePath);
      const name = filePath.split(/[/\\]/).pop() ?? filePath;
      return { name, content };
    } catch {
      return null;
    }
  }

  async saveFile(filename: string, content: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const rawPath = await save({
      defaultPath: filename,
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr'] }],
    });
    const path = normalizeDialogPath(rawPath);

    if (path) {
      try {
        await writeTextFile(path, content);
      } catch (error) {
        throw new Error(`Failed to write file: ${String(error)}`);
      }
      return path;
    }
    return null;
  }

  getPlatformInfo() {
    return { type: 'tauri' as const, version: APP_VERSION };
  }
}
