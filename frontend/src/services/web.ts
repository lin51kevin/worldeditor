/**
 * Web platform adapter.
 * Uses WASM for core logic, browser APIs for file I/O.
 * Geometry/rendering operations delegate to BasePlatformService.
 */

import type { PlatformService, Project } from './platform';
import { APP_VERSION } from './index';
import { BasePlatformService } from './basePlatformService';

export class WebPlatformService extends BasePlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const wasm = await this.getWasm();
    return wasm.parse_opendrive(xml) as unknown as Project;
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const wasm = await this.getWasm();
    return wasm.write_opendrive(JSON.stringify(project));
  }

  async openFile(): Promise<{ name: string; content: string; path?: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xodr,.xml';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const content = await file.text();
        resolve({ name: file.name, content });
      };
      input.click();
    });
  }

  // TODO: [Phase Web] 待实现 — web platform cannot access files by path; require user to re-pick
  async openFileByPath(_path: string): Promise<{ name: string; content: string } | null> {
    // Web cannot access files by path; fall back to file picker
    return this.openFile();
  }

  async saveFile(filename: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  getPlatformInfo() {
    return { type: 'web' as const, version: APP_VERSION };
  }
}
