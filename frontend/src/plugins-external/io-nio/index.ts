/**
 * io-nio — external NIO binary import/export plugin.
 * Parsing/serialisation is delegated to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-nio';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'NIO Binary',
    extensions: ['.pb', '.bin', '.nio.json'],
    disabled: false,
    onImport: (content) => ctx.codec.importFrom('nio', content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'NIO Binary',
    disabled: false,
    onExport: async (project) => {
      const bytes = (await ctx.codec.exportTo('nio', project)) as Uint8Array;
      await ctx.saveBinaryFile(`${project.name || 'export'}.bin`, bytes, ['bin', 'pb']);
    },
  });
});
