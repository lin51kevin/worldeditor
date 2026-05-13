/** plugin-satellite: OSM tiles and satellite imagery viewport overlay. Desktop only. Stub. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'satellite';
export function mountSatellitePlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Satellite', component: null as never, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement satellite imagery toggle behavior
  registerMenuItem({ id: `${PLUGIN_ID}:toggle`, pluginId: PLUGIN_ID, menu: 'view', label: 'Satellite Imagery', labelKey: 'satellite.toggle', onClick: () => {} });
  return () => unregisterPlugin(PLUGIN_ID);
}
