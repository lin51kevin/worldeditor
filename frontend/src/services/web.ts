/**
 * Web platform adapter.
 * Uses WASM for core logic, browser APIs for file I/O.
 * Geometry/rendering operations delegate to BasePlatformService.
 */

import type { PlatformService, Project } from './platform';
import { APP_VERSION } from './index';
import { BasePlatformService } from './basePlatformService';
import { downloadBlob } from '../utils/download';

export class WebPlatformService extends BasePlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const wasm = await this.getWasm();
    return wasm.parse_opendrive(xml) as unknown as Project;
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const wasm = await this.getWasm();
    return wasm.write_opendrive(JSON.stringify(project));
  }

  async openFile(): Promise<{ name: string; content: string; buffer?: ArrayBuffer; path?: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xodr,.xml,.geoz';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        // Binary formats (e.g. .geoz) return ArrayBuffer instead of text
        if (/\.geoz$/i.test(file.name)) {
          const buffer = await file.arrayBuffer();
          resolve({ name: file.name, content: '', buffer });
        } else {
          const content = await file.text();
          resolve({ name: file.name, content });
        }
      };
      input.click();
    });
  }

  // TODO: [Phase Web] 待实现 — web platform cannot access files by path without user gesture.
  // Returning null lets callers display a proper "file not found / not accessible" message
  // rather than silently opening a generic file picker, which is confusing for recent-file clicks.
  async openFileByPath(_path: string): Promise<{ name: string; content: string } | null> {
    return null;
  }

  async saveFile(filename: string, content: string): Promise<string | null> {
    downloadBlob(new Blob([content], { type: 'application/xml' }), filename);
    // Web can't resolve a real FS path; return the filename as a pseudo-identifier.
    return filename;
  }

  getPlatformInfo() {
    return { type: 'web' as const, version: APP_VERSION };
  }
}
