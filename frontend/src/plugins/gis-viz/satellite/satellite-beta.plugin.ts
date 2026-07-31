/** plugin-satellite: OSM tiles and satellite imagery viewport overlay. */
import SatellitePanel from './SatellitePanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { applySatelliteOverlay } from './satelliteState';

const PLUGIN_ID = 'satellite-beta';

export function mountSatellitePlugin(): () => void {
  const { registerPanel, registerViewportOverlay, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Satellite', titleKey: 'panels.satellite', component: SatellitePanel, position: 'right', category: 'gis' });
  registerViewportOverlay({
    id: `${PLUGIN_ID}:overlay`,
    pluginId: PLUGIN_ID,
    order: 10,
    render: (ctx) => applySatelliteOverlay(ctx?.canvas),
  });
  // Satellite overlay toggle is controlled from the Satellite panel directly.
  // No separate View-menu entry needed — the panel toggle appears in View > Panels.
  return () => unregisterPlugin(PLUGIN_ID);
}
