/**
 * io-xodr-ext — external OpenDRIVE Extended import/export plugin.
 *
 * Adds version migration (→ 1.6) on import and 1.6 export, delegating the
 * actual OpenDRIVE parse/write to the host WASM engine via ctx.codec.
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-xodr-ext';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'OpenDRIVE (Extended)',
    extensions: ['.xodr'],
    disabled: false,
    onImport: async (content) => {
      const project = await ctx.codec.importFrom('xodr', content);
      if (project.header) {
        project.header.rev_major = 1;
        project.header.rev_minor = 6;
      }
      return project;
    },
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'OpenDRIVE 1.6 (Extended)',
    disabled: false,
    onExport: async (project) => {
      const xml = (await ctx.codec.exportTo('xodr', project)) as string;
      await ctx.saveTextFile(`${project.name || 'export'}_v1.6.xodr`, xml, ['xodr']);
    },
  });
});
