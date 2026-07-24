/**
 * scripting-beta — external safe command console plugin (beta, trusted).
 */

import { getPluginApi } from '../sdk';
import { usePluginContribStore } from '../host';
import ScriptingPanel from './ScriptingPanel';
import { scriptingCss } from './styles';

const PLUGIN_ID = 'scripting-beta';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(scriptingCss);

  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Script Console',
    titleKey: 'panels.scriptConsole',
    component: ScriptingPanel,
    position: 'right',
  });

  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:open-panel`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Script Console',
    labelKey: 'panels.scriptConsole',
    onClick: () => {
      usePluginContribStore.getState().showPanel(`${PLUGIN_ID}:panel`);
      void ctx.ui.alert('Script Console opened.', 'Scripting');
    },
  });
});
