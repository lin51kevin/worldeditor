/** plugin-gis-tools: Advanced GIS coordinate system panel and tools. */
import { usePluginContribStore } from '../stores/pluginContribStore';

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
    onClick: () => { /* opens GIS Tools panel */ },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:set-crs`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Set Project CRS…',
    labelKey: 'gisTools.setCrs',
    onClick: () => { /* opens CRS picker dialog */ },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
