/**
 * plugin-io-nio: NIO binary import/export plugin.
 */

import type { Project } from '../../../services/platform';
import { saveExport } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importNio(content: string | ArrayBuffer): Promise<Project> {
  const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new TextEncoder().encode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  return wasm.import_from_nio(bytes) as Project;
}

async function exportNio(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const bytes = wasm.export_to_nio(JSON.stringify(project)) as Uint8Array;
  const payload = bytes.slice().buffer;
  const blob = new Blob([payload], { type: 'application/octet-stream' });
  await saveExport(blob, `${project.name || 'export'}.bin`, [{ name: 'NIO Binary', extensions: ['bin', 'pb'] }]);
}

export const mountIoNioPlugin = createIOPlugin({
  pluginId: 'io-nio',
  importer: {
    formatName: 'NIO Binary',
    extensions: ['.pb', '.bin', '.nio.json'],
    onImport: importNio,
  },
  exporter: {
    formatName: 'NIO Binary',
    onExport: exportNio,
  },
});