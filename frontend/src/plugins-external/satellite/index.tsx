/**
 * satellite-beta — external viewport basemap overlay plugin (beta, trusted).
 * Self-contained: its own zustand store + procedural CSS overlay (no network).
 */

import { getPluginApi } from '../sdk';
import SatellitePanel from './SatellitePanel';
import { satelliteCss } from './styles';
import { applySatelliteOverlay, useSatelliteOverlayStore } from './satelliteState';

const PLUGIN_ID = 'satellite-beta';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(satelliteCss);

  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Satellite',
    titleKey: 'panels.satellite',
    component: SatellitePanel,
    position: 'right',
  });

  ctx.registerViewportOverlay({
    id: `${PLUGIN_ID}:overlay`,
    pluginId: PLUGIN_ID,
    order: 10,
    render: (overlay) => applySatelliteOverlay(overlay?.canvas),
  });

  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:toggle`,
    pluginId: PLUGIN_ID,
    menu: 'view',
    label: 'Satellite Imagery',
    labelKey: 'satellite.toggle',
    onClick: () => {
      useSatelliteOverlayStore.getState().toggle();
      const enabled = useSatelliteOverlayStore.getState().enabled;
      void ctx.ui.alert(`Basemap overlay ${enabled ? 'enabled' : 'disabled'}.`, 'Satellite');
    },
  });
});
