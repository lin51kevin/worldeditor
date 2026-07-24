/**
 * io-dxf — external AutoCAD DXF import/export plugin.
 * Parsing/serialisation is delegated to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-dxf';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'DXF CAD',
    extensions: ['.dxf'],
    disabled: false,
    onImport: (content) => ctx.codec.importFrom('dxf', content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'DXF CAD',
    disabled: false,
    onExport: async (project) => {
      const dxf = (await ctx.codec.exportTo('dxf', project)) as string;
      await ctx.saveTextFile(`${project.name || 'export'}.dxf`, dxf, ['dxf']);
    },
  });
});
