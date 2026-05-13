/** plugin-validation: OpenDRIVE validation panel and tools. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';

const PLUGIN_ID = 'validation';

export function mountValidationPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Validation',
    component: null as never,
    position: 'bottom',
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:validate`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Validate Project',
    labelKey: 'validation.validateProject',
    onClick: () => { void showAlert('Validation is coming soon (Phase 3).', 'Coming Soon'); },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:topology`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Check Topology',
    labelKey: 'validation.checkTopology',
    onClick: () => { void showAlert('Validation is coming soon (Phase 3).', 'Coming Soon'); },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
