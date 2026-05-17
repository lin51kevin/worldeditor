/**
 * plugin-io-mif: MapInfo MIF import/export plugin.
 *
 * Delegates parsing and serialization to the Rust we-io MIF implementation.
 */

import type { Project } from '../../../services/platform';
import { downloadBlob } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importMif(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  return wasm.import_from_mif(text) as Project;
}

async function exportMif(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const mif = wasm.export_to_mif(JSON.stringify(project));
  const blob = new Blob([mif], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${project.name || 'export'}.mif`);
}

export const mountIoMifPlugin = createIOPlugin({
  pluginId: 'io-mif',
  importer: {
    formatName: 'MapInfo MIF',
    extensions: ['.mif'],
    onImport: importMif,
  },
  exporter: {
    formatName: 'MapInfo MIF',
    onExport: exportMif,
  },
});