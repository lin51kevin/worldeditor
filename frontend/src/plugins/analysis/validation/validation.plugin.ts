/** plugin-validation: OpenDRIVE validation panel and tools. */
import { ValidationPanel } from './ValidationPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'validation';

export function mountValidationPlugin(): () => void {
  const { registerPanel, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Validation',
    titleKey: 'panels.validation',
    component: ValidationPanel,
    position: 'right',
    category: 'analysis',
  });

  return () => unregisterPlugin(PLUGIN_ID);
}