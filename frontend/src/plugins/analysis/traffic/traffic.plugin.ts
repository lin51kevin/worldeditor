/** plugin-traffic: Traffic signal phasing, timing editor, and SUMO I/O. */
import { showAlert } from '../../../utils/dialog';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { createEmptyProject } from '../../core/emptyProject';

const PLUGIN_ID = 'traffic';

export function mountTrafficPlugin(): () => void {
  const { registerPanel, registerMenuItem, registerImporter, registerExporter, unregisterPlugin } =
    usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Traffic',
    component: null as never,
    position: 'right',
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:auto-signals`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Auto-Deploy Signals',
    labelKey: 'traffic.autoDeploySignals',
    onClick: () => { void showAlert('Traffic tools are coming soon (Phase 3).', 'Coming Soon'); },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:compute-phases`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Compute Signal Phases',
    labelKey: 'traffic.computePhases',
    onClick: () => { void showAlert('Traffic tools are coming soon (Phase 3).', 'Coming Soon'); },
  });

  registerImporter({
    id: `${PLUGIN_ID}:sumo-importer`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    extensions: ['.net.xml', '.xml'],
    onImport: async () => {
      await showAlert('SUMO import is coming soon (Phase 3).', 'Coming Soon');
      return createEmptyProject('SUMO Import');
    },
  });

  registerExporter({
    id: `${PLUGIN_ID}:sumo-exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    onExport: async () => {
      await showAlert('SUMO export is coming soon (Phase 3).', 'Coming Soon');
    },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
