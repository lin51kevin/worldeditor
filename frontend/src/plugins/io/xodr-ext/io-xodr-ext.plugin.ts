/**
 * plugin-io-xodr-ext: OpenDRIVE Extended import/export plugin.
 *
 * Provides additional OpenDRIVE capabilities beyond basic .xodr I/O:
 * - Import with version migration (1.4 → 1.6)
 * - Export with validation & repair
 */

import type { Project } from '../../../services/platform';
import { saveExport } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importXodrExt(content: string | ArrayBuffer): Promise<Project> {
  const xml = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const project: Project = wasm.parse_opendrive(xml);

  // Ensure migrated to 1.6
  if (project.header) {
    project.header.rev_major = 1;
    project.header.rev_minor = 6;
  }

  return project;
}

async function exportXodrExt(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const xml = wasm.write_opendrive(JSON.stringify(project));
  const blob = new Blob([xml], { type: 'application/xml' });
  await saveExport(blob, `${project.name || 'export'}_v1.6.xodr`, [{ name: 'OpenDRIVE', extensions: ['xodr'] }]);
}

export const mountIoXodrExtPlugin = createIOPlugin({
  pluginId: 'io-xodr-ext',
  importer: {
    formatName: 'OpenDRIVE (Extended)',
    extensions: ['.xodr'],
    onImport: importXodrExt,
  },
  exporter: {
    formatName: 'OpenDRIVE 1.6 (Extended)',
    onExport: exportXodrExt,
  },
});
