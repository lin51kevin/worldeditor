/** plugin-traffic: Traffic signal phasing, timing editor, and SUMO I/O. */
import TrafficPanel from './TrafficPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { downloadBlob } from '../../../utils/download';
import { showAlert } from '../../../utils/dialog';
import { exportSumoNetwork, importSumoNetwork } from './trafficUtils';
import { useProjectStore } from '../../../stores/projectStore';

const PLUGIN_ID = 'traffic';

export function mountTrafficPlugin(): () => void {
  const { registerPanel, registerMenuItem, registerImporter, registerExporter, unregisterPlugin } =
    usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Traffic',
    titleKey: 'panels.traffic',
    component: TrafficPanel,
    position: 'right',
  });

  registerMenuItem({
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
          await showAlert(`Imported ${project.roads.length} road(s) from SUMO.`, 'Traffic');
        } catch (err) {
          await showAlert(err instanceof Error ? err.message : String(err), 'Import Error');
        }
      };
      input.click();
    },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:export-sumo`,
    pluginId: PLUGIN_ID,
    menu: 'file',
    label: 'Export SUMO Network…',
    labelKey: 'traffic.exportSumo',
    group: 'export',
    onClick: async () => {
      const project = useProjectStore.getState().project;
      const xml = exportSumoNetwork(project);
      const blob = new Blob([xml], { type: 'application/xml' });
      downloadBlob(blob, `${project.name || 'export'}.net.xml`);
      await showAlert(`Exported ${project.roads.length} road(s) to SUMO.`, 'Traffic');
    },
  });

  registerImporter({
    id: `${PLUGIN_ID}:sumo-importer`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    extensions: ['.net.xml', '.xml'],
    onImport: async (content, fileName) => {
      const project = importSumoNetwork(content, fileName);
      await showAlert(`Imported ${project.roads.length} road(s) from SUMO.`, 'Traffic');
      return project;
    },
  });

  registerExporter({
    id: `${PLUGIN_ID}:sumo-exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    onExport: async (project) => {
      const xml = exportSumoNetwork(project);
      const blob = new Blob([xml], { type: 'application/xml' });
      downloadBlob(blob, `${project.name || 'export'}.net.xml`);
      await showAlert(`Exported ${project.roads.length} road(s) to SUMO.`, 'Traffic');
    },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
