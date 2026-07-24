/**
 * io-lanelet2 — external Lanelet2 OSM-XML import/export plugin.
 * Parsing/serialisation is delegated to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-lanelet2';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'Lanelet2 OSM-XML',
    extensions: ['.osm', '.xml'],
    disabled: false,
    onImport: (content) => ctx.codec.importFrom('lanelet2', content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'Lanelet2 OSM-XML',
    disabled: false,
    onExport: async (project) => {
      const xml = (await ctx.codec.exportTo('lanelet2', project)) as string;
      await ctx.saveTextFile(`${project.name || 'export'}_lanelet2.osm`, xml, ['osm', 'xml']);
    },
  });
});
