import type { Project } from '../../../services/platform';
import { saveExport } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importShapefile(content: string | ArrayBuffer): Promise<Project> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  return wasm.import_from_shapefile(bytes) as Project;
}

async function exportShapefile(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const bytes = wasm.export_to_shapefile(JSON.stringify(project));
  const buffer = bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  await saveExport(blob, `${project.name || 'export'}.shp`, [{ name: 'Shapefile', extensions: ['shp'] }]);
}

export const mountIoShapefilePlugin = createIOPlugin({
  pluginId: 'io-shapefile',
  importer: {
    formatName: 'Shapefile Bundle',
    extensions: ['.shp'],
    onImport: importShapefile,
  },
  exporter: {
    formatName: 'Shapefile Bundle',
    onExport: exportShapefile,
  },
});