/** plugin-converter: Batch format conversion panel. Uses registered importers/exporters. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'converter';
export function mountConverterPlugin(): () => void {
  const { registerPanel, registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Batch Converter', component: null as never, position: 'float' });
  registerMenuItem({ id: `${PLUGIN_ID}:open`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Batch Convert…', labelKey: 'converter.batchConvert', onClick: () => { void showAlert('Batch converter is coming soon (Phase 3).', 'Coming Soon'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
