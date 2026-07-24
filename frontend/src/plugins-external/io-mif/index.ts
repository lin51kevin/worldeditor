/**
 * io-mif — external MapInfo MIF import/export plugin.
 * Parsing/serialisation is delegated to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-mif';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'MapInfo MIF',
    extensions: ['.mif'],
    disabled: false,
    onImport: (content) => ctx.codec.importFrom('mif', content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'MapInfo MIF',
    disabled: false,
    onExport: async (project) => {
      const mif = (await ctx.codec.exportTo('mif', project)) as string;
      await ctx.saveTextFile(`${project.name || 'export'}.mif`, mif, ['mif']);
    },
  });
});
