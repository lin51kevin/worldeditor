import type { Project } from '../../../services/platform';
import { saveExport } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importDxf(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  return wasm.import_from_dxf(text) as Project;
}

async function exportDxf(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const dxf = wasm.export_to_dxf(JSON.stringify(project));
  const blob = new Blob([dxf], { type: 'application/dxf' });
  await saveExport(blob, `${project.name || 'export'}.dxf`, [{ name: 'DXF CAD', extensions: ['dxf'] }]);
}

export const mountIoDxfPlugin = createIOPlugin({
  pluginId: 'io-dxf',
  importer: {
    formatName: 'DXF CAD',
    extensions: ['.dxf'],
    onImport: importDxf,
  },
  exporter: {
    formatName: 'DXF CAD',
    onExport: exportDxf,
  },
});