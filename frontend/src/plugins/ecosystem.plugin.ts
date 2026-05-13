/** plugin-ecosystem: Vegetation and tree placement panel. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'ecosystem';
export function mountEcosystemPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Ecosystem', component: null as never, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement procedural tree placement workflow
  registerMenuItem({ id: `${PLUGIN_ID}:place-trees`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Place Trees', labelKey: 'ecosystem.placeTrees', onClick: () => { void showAlert('Ecosystem tools are coming soon (Phase 3).', 'Coming Soon'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
