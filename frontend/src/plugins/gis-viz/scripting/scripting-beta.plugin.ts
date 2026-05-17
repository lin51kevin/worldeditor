/** plugin-scripting: Safe command console for project inspection and light automation. */
import ScriptingPanel from './ScriptingPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { showAlert } from '../../../utils/dialog';

const PLUGIN_ID = 'scripting-beta';

export function mountScriptingPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Script Console', titleKey: 'panels.scriptConsole', component: ScriptingPanel, position: 'right' });
  registerMenuItem({
    id: `${PLUGIN_ID}:open-panel`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Script Console',
    labelKey: 'panels.scriptConsole',
    onClick: () => {
      usePluginContribStore.getState().showPanel(`${PLUGIN_ID}:panel`);
      void showAlert('Script Console opened.', 'Scripting');
    },
  });
  return () => unregisterPlugin(PLUGIN_ID);
}
