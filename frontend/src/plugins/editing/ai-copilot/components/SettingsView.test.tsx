import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import type { CopilotConfig } from '../core/config-store';
import { getDefaultConfig } from '../core/config-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'copilot.settingsTitle': 'AI 助手设置',
        'copilot.settingsProvider': 'AI Provider',
        'copilot.settingsProviderHint': '输入或选择服务商',
        'copilot.settingsApiUrl': '接口地址 (Base URL)',
        'copilot.settingsApiKey': 'API Key',
        'copilot.settingsGetApiKey': '获取 API Key',
        'copilot.settingsModel': '模型',
        'copilot.settingsSave': '保存',
        'copilot.settingsCancel': '取消',
        'copilot.settingsApiKeyPlaceholder': '(可选)',
        'copilot.settingsModelPlaceholder': '输入或选择模型名称',
        'copilot.settingsClose': '关闭',
        'copilot.settingsTestConnection': '测试连接',
        'copilot.settingsTesting': '测试中...',
        'copilot.settingsConnected': '已连接',
        'copilot.settingsFailed': '连接失败',
        'copilot.settingsInvalidConfig': '配置无效，请检查接口地址',
      };
      return map[key] || key;
    },
  }),
}));

// Mock OpenAICompatibleProvider
vi.mock('../providers/openai-compatible', () => ({
  OpenAICompatibleProvider: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue(true),
    chat: vi.fn(),
  })),
}));

const defaultConfig = getDefaultConfig();

function renderSettings(overrides?: Partial<CopilotConfig>) {
  const config = { ...defaultConfig, ...overrides };
  const onSave = vi.fn();
  const onClose = vi.fn();

  const utils = render(<SettingsView config={config} onSave={onSave} onClose={onClose} />);
  return { config, onSave, onClose, ...utils };
}

describe('SettingsView', () => {
  it('renders all fields and buttons', () => {
    renderSettings();

    expect(screen.getByText('AI 助手设置')).toBeDefined();
    expect(screen.getByText('AI Provider')).toBeDefined();
    expect(screen.getByText('接口地址 (Base URL)')).toBeDefined();
    expect(screen.getByText('模型')).toBeDefined();
    expect(screen.getByText('保存')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
    expect(screen.getByText('测试连接')).toBeDefined();
  });

  it('shows provider description when a known preset is selected', () => {
    renderSettings();
    // Default is ollama — should show description
    expect(screen.getByText(/本地模型推理/)).toBeDefined();
  });

  it('auto-fills baseUrl when selecting a preset provider', () => {
    renderSettings();

    const providerInput = screen.getByDisplayValue('ollama') as HTMLInputElement;
    fireEvent.change(providerInput, { target: { value: 'openai' } });

    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeDefined();
  });

  it('shows API Key field only for cloud providers', () => {
    renderSettings();
    // Ollama is 'local' — API Key should NOT be visible
    expect(screen.queryByText('API Key')).toBeNull();
  });

  it('shows API Key field for cloud providers', () => {
    renderSettings({
      activeProviderId: 'openai',
      providers: {
        openai: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o' },
      },
    });

    expect(screen.getByText('API Key')).toBeDefined();
  });

  it('shows "获取 API Key" link for cloud providers with apiKeyUrl', () => {
    renderSettings({
      activeProviderId: 'openai',
      providers: {
        openai: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o' },
      },
    });

    expect(screen.getByText('获取 API Key')).toBeDefined();
  });

  it('calls onSave with correct config', () => {
    const { onSave } = renderSettings({
      activeProviderId: 'openai',
      providers: {
        openai: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o' },
      },
    });

    const apikeyInput = screen.getByPlaceholderText('sk-...') as HTMLInputElement;
    fireEvent.change(apikeyInput, { target: { value: 'sk-test-123' } });

    fireEvent.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0]![0] as CopilotConfig;
    expect(saved.providers.openai?.apiKey).toBe('sk-test-123');
  });

  it('calls onClose when cancel button is clicked', () => {
    const { onClose } = renderSettings();

    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when X button is clicked', () => {
    const { onClose } = renderSettings();

    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders test connection button', () => {
    renderSettings();
    expect(screen.getByTestId('test-connection-btn')).toBeDefined();
  });

  it('shows connected status after successful test', async () => {
    renderSettings();

    const testBtn = screen.getByTestId('test-connection-btn');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('已连接')).toBeDefined();
    });
  });

  it('uses provider datalist for autocomplete', () => {
    renderSettings();

    const datalist = document.getElementById('copilot-provider-list');
    expect(datalist).toBeTruthy();
    expect(datalist?.querySelectorAll('option').length).toBeGreaterThan(5);
  });

  it('uses i18n keys for labels (not hardcoded Chinese)', () => {
    renderSettings();

    expect(screen.getByText('AI 助手设置')).toBeDefined();
    expect(screen.getByText('AI Provider')).toBeDefined();
    expect(screen.getByText('模型')).toBeDefined();
    expect(screen.getByText('保存')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
  });
});
