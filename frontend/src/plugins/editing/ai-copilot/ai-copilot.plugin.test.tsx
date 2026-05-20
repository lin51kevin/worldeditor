/**
 * AI Copilot Plugin Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { mountAiCopilotPlugin } from './ai-copilot.plugin';

vi.mock('./core/config-store', () => ({
  loadConfig: vi.fn().mockReturnValue({
    activeProviderId: 'ollama',
    providers: {
      ollama: { id: 'ollama', name: 'Ollama', baseUrl: '', apiKey: '', model: 'qwen2.5-coder' },
    },
    applyMode: 'manual',
    maxHistoryLength: 50,
  }),
  saveConfig: vi.fn(),
}));

vi.mock('./core/copilot-engine', () => ({
  CopilotEngine: vi.fn().mockImplementation(() => ({
    handleInput: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    reset: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    configure: vi.fn(),
  })),
}));

describe('AI Copilot Plugin', () => {
  beforeEach(() => {
    // Reset store state between tests
    usePluginContribStore.setState({
      panels: [],
      toolbarButtons: [],
      panelTabVisibility: {},
    });
  });

  it('registers a panel in the store', () => {
    mountAiCopilotPlugin();

    const panels = usePluginContribStore.getState().panels;
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe('ai-copilot:panel');
    expect(panels[0]!.pluginId).toBe('ai-copilot');
    expect(panels[0]!.position).toBe('right');
  });

  it('does not register a floating toolbar button (button is in MenuBar)', () => {
    mountAiCopilotPlugin();

    const buttons = usePluginContribStore.getState().toolbarButtons;
    const btn = buttons.find((b) => b.pluginId === 'ai-copilot');
    expect(btn).toBeUndefined();
  });

  it('panel renders title, message area, and input', () => {
    mountAiCopilotPlugin();
    const panels = usePluginContribStore.getState().panels;
    const PanelComponent = panels[0]!.component;

    render(<PanelComponent />);

    // Title renders as hardcoded "AI Copilot"
    expect(screen.getByText('AI Copilot')).toBeInTheDocument();

    // Message area exists
    const messageArea = screen.getByTestId('copilot-messages');
    expect(messageArea).toBeInTheDocument();

    // Input textarea exists (zh locale: "描述你想做什么...")
    const input = screen.getByPlaceholderText('描述你想做什么...') as HTMLTextAreaElement;
    expect(input).toBeInTheDocument();
  });

  it('allows typing in the input field', () => {
    mountAiCopilotPlugin();
    const panels = usePluginContribStore.getState().panels;
    const PanelComponent = panels[0]!.component;

    render(<PanelComponent />);

    const input = screen.getByPlaceholderText('描述你想做什么...') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '生成道路' } });
    expect(input.value).toBe('生成道路');
  });

  it('cleanup removes panel contributions', () => {
    const cleanup = mountAiCopilotPlugin();

    expect(usePluginContribStore.getState().panels).toHaveLength(1);

    cleanup();

    expect(usePluginContribStore.getState().panels).toHaveLength(0);
    expect(
      usePluginContribStore.getState().toolbarButtons.filter((b) => b.pluginId === 'ai-copilot'),
    ).toHaveLength(0);
  });
});
