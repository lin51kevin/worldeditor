/**
 * io-shapefile — external Shapefile bundle import/export plugin.
 * Parsing/serialisation is delegated to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-shapefile';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'Shapefile Bundle',
    extensions: ['.shp'],
    disabled: false,
    onImport: (content) => ctx.codec.importFrom('shapefile', content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'Shapefile Bundle',
    disabled: false,
    onExport: async (project) => {
      const bytes = (await ctx.codec.exportTo('shapefile', project)) as Uint8Array;
      await ctx.saveBinaryFile(`${project.name || 'export'}.shp`, bytes, ['shp']);
    },
  });
});
