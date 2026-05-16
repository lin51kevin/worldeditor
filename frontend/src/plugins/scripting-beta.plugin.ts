/** plugin-scripting: Embedded Rhai script console. Stub — Phase 3. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'scripting-beta';
export function mountScriptingPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Script Console', component: null as never, position: 'bottom' });
  // TODO: [Phase 3] 待实现 — implement script execution from the embedded console
  registerMenuItem({ id: `${PLUGIN_ID}:run`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Run Script', labelKey: 'scripting.runScript', onClick: () => { void showAlert('Script console is coming soon (Phase 3).', 'Coming Soon'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
