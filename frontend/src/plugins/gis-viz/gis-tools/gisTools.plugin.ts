/** plugin-gis-tools: Advanced GIS coordinate system panel and tools. */
import GisToolsPanel from './GisToolsPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'gis-tools';

export function mountGisToolsPlugin(): () => void {
  const { registerPanel, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'GIS Tools',
    titleKey: 'panels.gisTools',
    component: GisToolsPanel,
    position: 'right',
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
