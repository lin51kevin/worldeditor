/** plugin-converter: Batch format conversion panel. Uses registered importers/exporters. */
import ConverterPanel from './ConverterPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'converter';

export function mountConverterPlugin(): () => void {
  const { registerPanel, unregisterPlugin } = usePluginContribStore.getState();

  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Batch Converter',
    titleKey: 'panels.batchConverter',
    component: ConverterPanel,
    position: 'right',
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
