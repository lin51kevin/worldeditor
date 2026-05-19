/**
 * AI Copilot Plugin
 *
 * Contributes an AI assistant panel (right side).
 * Call mountAiCopilotPlugin() once on app init; returns a cleanup function.
 */
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import type { PanelContrib } from '../../../stores/pluginContribStore';
import { Sparkles } from 'lucide-react';
import { CopilotPanel } from './components/CopilotPanel';

const PLUGIN_ID = 'ai-copilot';

export function mountAiCopilotPlugin(): () => void {
  const { registerPanel, unregisterPlugin } =
    usePluginContribStore.getState();

  const panel: PanelContrib = {
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    titleKey: 'copilot.title',
    title: 'AI Copilot',
    component: CopilotPanel,
    position: 'right',
    icon: <Sparkles size={14} />,
  };

  registerPanel(panel);

  return () => unregisterPlugin(PLUGIN_ID);
}
