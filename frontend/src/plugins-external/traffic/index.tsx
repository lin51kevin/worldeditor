/**
 * traffic — external traffic control plugin (trusted, first-party).
 *
 * Panel with signal/phase stats + SUMO network import/export (menu + importer/
 * exporter contributions). Delegates format logic to the shared trafficUtils.
 */

import { getPluginApi } from '../sdk';
import { useProjectStore } from '../host';
import TrafficPanel from './TrafficPanel';
import { trafficCss } from './styles';
import { exportSumoNetwork, importSumoNetwork } from '../../plugins/analysis/traffic/trafficUtils';
import { isExportCancelled } from '../../utils/exportErrors';

const PLUGIN_ID = 'traffic';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(trafficCss);

  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Traffic',
    titleKey: 'panels.traffic',
    component: TrafficPanel,
    position: 'right',
  });

  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:import-sumo`,
    pluginId: PLUGIN_ID,
    menu: 'file',
    label: 'Import SUMO Network…',
    labelKey: 'traffic.importSumo',
    group: 'import',
    onClick: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.net.xml,.xml';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const content = await file.arrayBuffer();
          const project = importSumoNetwork(content, file.name);
          useProjectStore.getState().setProject(project);
          await ctx.ui.alert(`Imported ${project.roads.length} road(s) from SUMO.`, 'Traffic');
        } catch (err) {
          await ctx.ui.alert(err instanceof Error ? err.message : String(err), 'Import Error');
        }
      };
      input.click();
    },
  });

  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:export-sumo`,
    pluginId: PLUGIN_ID,
    menu: 'file',
    label: 'Export SUMO Network…',
    labelKey: 'traffic.exportSumo',
    group: 'export',
    onClick: async () => {
      const project = useProjectStore.getState().project;
      const xml = exportSumoNetwork(project);
      try {
        await ctx.saveTextFile(`${project.name || 'export'}.net.xml`, xml, ['xml']);
      } catch (err) {
        if (isExportCancelled(err)) return; // User cancelled the save dialog.
        await ctx.ui.alert(err instanceof Error ? err.message : String(err), 'Export Error');
        return;
      }
      await ctx.ui.alert(`Exported ${project.roads.length} road(s) to SUMO.`, 'Traffic');
    },
  });

  ctx.registerImporter({
    id: `${PLUGIN_ID}:sumo-importer`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    extensions: ['.net.xml', '.xml'],
    onImport: async (content, fileName) => {
      const project = importSumoNetwork(content, fileName);
      await ctx.ui.alert(`Imported ${project.roads.length} road(s) from SUMO.`, 'Traffic');
      return project;
    },
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:sumo-exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    onExport: async (project) => {
      const xml = exportSumoNetwork(project);
      await ctx.saveTextFile(`${project.name || 'export'}.net.xml`, xml, ['xml']);
    },
  });
});
