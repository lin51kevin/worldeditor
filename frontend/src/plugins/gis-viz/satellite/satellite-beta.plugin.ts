/** plugin-satellite: OSM tiles and satellite imagery viewport overlay. */
import SatellitePanel from './SatellitePanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { showAlert } from '../../../utils/dialog';
import { applySatelliteOverlay, useSatelliteOverlayStore } from './satelliteState';

const PLUGIN_ID = 'satellite-beta';

export function mountSatellitePlugin(): () => void {
  const { registerPanel, registerMenuItem, registerViewportOverlay, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Satellite', titleKey: 'panels.satellite', component: SatellitePanel, position: 'right' });
  registerViewportOverlay({
    id: `${PLUGIN_ID}:overlay`,
    pluginId: PLUGIN_ID,
    order: 10,
    render: (ctx) => applySatelliteOverlay(ctx?.canvas),
  });
  registerMenuItem({
    id: `${PLUGIN_ID}:toggle`,
    pluginId: PLUGIN_ID,
    menu: 'view',
    label: 'Satellite Imagery',
    labelKey: 'satellite.toggle',
    onClick: () => {
      useSatelliteOverlayStore.getState().toggle();
      const enabled = useSatelliteOverlayStore.getState().enabled;
      void showAlert(`Basemap overlay ${enabled ? 'enabled' : 'disabled'}.`, 'Satellite');
    },
  });
  return () => unregisterPlugin(PLUGIN_ID);
}
