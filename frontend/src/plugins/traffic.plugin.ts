/** plugin-traffic: Traffic signal phasing, timing editor, and SUMO I/O. */
import { usePluginContribStore } from '../stores/pluginContribStore';

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
    onClick: () => { /* auto-deploy signal logic */ },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:compute-phases`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Compute Signal Phases',
    labelKey: 'traffic.computePhases',
    onClick: () => { /* compute phase timing */ },
  });

  registerImporter({
    id: `${PLUGIN_ID}:sumo-importer`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    extensions: ['.net.xml', '.xml'],
    onImport: () => Promise.reject(new Error('SUMO import requires Phase 3')),
  });

  registerExporter({
    id: `${PLUGIN_ID}:sumo-exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'SUMO Network',
    onExport: () => Promise.reject(new Error('SUMO export requires Phase 3')),
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
