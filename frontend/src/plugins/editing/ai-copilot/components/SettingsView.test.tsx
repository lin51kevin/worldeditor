import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import type { CopilotConfig } from '../core/config-store';
import { getDefaultConfig } from '../core/config-store';

const defaultConfig = getDefaultConfig();

function renderSettings(overrides?: Partial<CopilotConfig>) {
  const config = { ...defaultConfig, ...overrides };
  const onSave = vi.fn();
  const onClose = vi.fn();

  const utils = render(<SettingsView config={config} onSave={onSave} onClose={onClose} />);
  return { config, onSave, onClose, ...utils };
}

describe('SettingsView', () => {
  it('renders all fields and save button', () => {
    renderSettings();

    expect(screen.getByText('⚙️ AI 助手设置')).toBeDefined();
    expect(screen.getByText('AI Provider')).toBeDefined();
    expect(screen.getByText('API 地址')).toBeDefined();
    expect(screen.getByText('API Key')).toBeDefined();
    expect(screen.getByText('模型')).toBeDefined();
    expect(screen.getByText('应用模式')).toBeDefined();
    expect(screen.getByText('保存设置')).toBeDefined();
    expect(screen.getByText('手动确认 (推荐)')).toBeDefined();
    expect(screen.getByText('自动执行')).toBeDefined();
  });

  it('auto-fills baseUrl when selecting a preset provider', () => {
    renderSettings();

    const select = screen.getByDisplayValue('Ollama') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'openai' } });

    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeDefined();
  });

  it('calls onSave with correct config when fields are modified and saved', () => {
    const { onSave } = renderSettings();

    const apikeyInput = screen.getByPlaceholderText('(可选)') as HTMLInputElement;
    fireEvent.change(apikeyInput, { target: { value: 'sk-test-123' } });

    fireEvent.click(screen.getByText('保存设置'));

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0]![0] as CopilotConfig;
    expect(saved.providers.ollama?.apiKey).toBe('sk-test-123');
  });

  it('renders API Key field with type="password"', () => {
    renderSettings();

    const apikeyInput = screen.getByPlaceholderText('(可选)') as HTMLInputElement;
    expect(apikeyInput.type).toBe('password');
  });

  it('calls onClose when close button is clicked', () => {
    const { onClose } = renderSettings();

    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
