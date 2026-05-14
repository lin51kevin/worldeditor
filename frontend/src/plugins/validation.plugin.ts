/** plugin-validation: OpenDRIVE validation panel and tools. */
import { showAlert } from '../utils/dialog';
import { ValidationPanel } from '../components/panels/ValidationPanel';
import { usePluginContribStore } from '../stores/pluginContribStore';

const PLUGIN_ID = 'validation';

export function mountValidationPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Validation',
    component: ValidationPanel,
    position: 'bottom',
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:validate`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Validate Project',
    labelKey: 'validation.validateProject',
    onClick: () => {
      void showAlert('Open the Validation panel to check your project.', 'Validation');
      const panel = document.querySelector('[data-panel-id="validation:panel"]');
      if (panel) (panel as HTMLElement).scrollIntoView({ behavior: 'smooth' });
    },
  });

  registerMenuItem({
    id: `${PLUGIN_ID}:topology`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Check Topology',
    labelKey: 'validation.checkTopology',
    onClick: () => {
      void showAlert('Open the Validation panel to check topology.', 'Topology');
      const panel = document.querySelector('[data-panel-id="validation:panel"]');
      if (panel) (panel as HTMLElement).scrollIntoView({ behavior: 'smooth' });
    },
  });

  return () => unregisterPlugin(PLUGIN_ID);
}