/** plugin-ecosystem: Vegetation and tree placement panel. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'ecosystem';
export function mountEcosystemPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Ecosystem', component: null as never, position: 'left' });
  registerMenuItem({ id: `${PLUGIN_ID}:place-trees`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Place Trees', labelKey: 'ecosystem.placeTrees', onClick: () => {} });
  return () => unregisterPlugin(PLUGIN_ID);
}
