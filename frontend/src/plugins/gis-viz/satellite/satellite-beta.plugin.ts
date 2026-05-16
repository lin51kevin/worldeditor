/** plugin-satellite: OSM tiles and satellite imagery viewport overlay. Desktop only. Stub. */
import { showAlert } from '../../../utils/dialog';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
const PLUGIN_ID = 'satellite-beta';
export function mountSatellitePlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Satellite', component: null as never, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement satellite imagery toggle behavior
  registerMenuItem({ id: `${PLUGIN_ID}:toggle`, pluginId: PLUGIN_ID, menu: 'view', label: 'Satellite Imagery', labelKey: 'satellite.toggle', onClick: () => { void showAlert('Satellite imagery is coming soon (Phase 3).', 'Coming Soon'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
