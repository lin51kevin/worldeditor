/** plugin-scripting: Safe command console for project inspection and light automation. */
import ScriptingPanel from './ScriptingPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'scripting-beta';

export function mountScriptingPlugin(): () => void {
  const { registerPanel, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Script Console', titleKey: 'panels.scriptConsole', component: ScriptingPanel, position: 'right', category: 'tools' });
  // Panel toggle appears in View > Panels — no separate Tools-menu entry needed.
  return () => unregisterPlugin(PLUGIN_ID);
}
