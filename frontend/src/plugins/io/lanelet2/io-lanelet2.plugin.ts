/**
 * plugin-io-lanelet2: Lanelet2 OSM-XML import/export plugin.
 *
 * Delegates to the Rust we-core lanelet2 parser/writer via WASM.
 */

import type { Project } from '../../../services/platform';
import { downloadBlob } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importLanelet2(content: string | ArrayBuffer): Promise<Project> {
  const xml = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const project: Project = wasm.import_from_lanelet2(xml);
  return project;
}

async function exportLanelet2(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const xml = wasm.export_to_lanelet2(JSON.stringify(project));
  const blob = new Blob([xml], { type: 'application/xml' });
  downloadBlob(blob, `${project.name || 'export'}_lanelet2.osm`);
}

export const mountIoLanelet2Plugin = createIOPlugin({
  pluginId: 'io-lanelet2',
  importer: {
    formatName: 'Lanelet2 OSM-XML',
    extensions: ['.osm', '.xml'],
    onImport: importLanelet2,
  },
  exporter: {
    formatName: 'Lanelet2 OSM-XML',
    onExport: exportLanelet2,
  },
});
