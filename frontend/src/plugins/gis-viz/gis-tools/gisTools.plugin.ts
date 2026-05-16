/** plugin-gis-tools: Advanced GIS coordinate system panel and tools. */
import { showAlert } from '../../../utils/dialog';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'gis-tools';

export function mountGisToolsPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'GIS Tools',
    component: null as never, // UI component registered at runtime
    position: 'left',
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:coord-converter`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Coordinate Converter',
    labelKey: 'gisTools.coordConverter',
    onClick: () => { void showAlert('GIS Tools is coming soon (Phase 3).', 'Coming Soon'); },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:set-crs`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Set Project CRS…',
    labelKey: 'gisTools.setCrs',
    onClick: () => { void showAlert('GIS Tools is coming soon (Phase 3).', 'Coming Soon'); },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
