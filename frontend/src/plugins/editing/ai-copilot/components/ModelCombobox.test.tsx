import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelCombobox } from './ModelCombobox';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'copilot.settingsModelPlaceholder': '输入或选择模型名称',
        'copilot.settingsModelHint': '支持手动输入或粘贴任意模型 ID',
        'copilot.settingsFetchModels': '从 API 获取',
        'copilot.settingsFetchingModels': '获取中...',
        'copilot.settingsFetchModelsError': '获取模型列表失败',
        'copilot.settingsNoMatchingModels': '无匹配模型',
        'copilot.settingsNoModels': '暂无模型',
      };
      return map[key] || key;
    },
  }),
}));

const PRESET_MODELS = [
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4',
  'zhipu/glm-4-flash',
];

describe('ModelCombobox', () => {
  it('renders input with correct value', () => {
    render(
      <ModelCombobox
        value="deepseek/deepseek-chat"
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    expect(input.value).toBe('deepseek/deepseek-chat');
  });

  it('shows hint text for manual input support', () => {
    render(
      <ModelCombobox
        value=""
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
      />
    );

    expect(screen.getByText('支持手动输入或粘贴任意模型 ID')).toBeDefined();
  });

  it('opens dropdown on input focus', () => {
    render(
      <ModelCombobox
        value=""
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    expect(screen.getByTestId('model-combobox-dropdown')).toBeDefined();
  });

  it('filters models based on input text', () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value=""
        onChange={onChange}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'deepseek' } });

    // Should show only deepseek models
    const items = screen.getAllByRole('button', { name: /deepseek/ });
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onChange when typing in input', () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value=""
        onChange={onChange}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.change(input, { target: { value: 'my-custom-model' } });

    expect(onChange).toHaveBeenCalledWith('my-custom-model');
  });

  it('selects a model from dropdown', () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value=""
        onChange={onChange}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    // Click on a model item
    const item = screen.getByTitle('zhipu/glm-4-flash');
    fireEvent.click(item);

    expect(onChange).toHaveBeenCalledWith('zhipu/glm-4-flash');
  });

  it('shows fetch button when onFetchModels is provided', () => {
    render(
      <ModelCombobox
        value=""
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
        onFetchModels={async () => ['model-a', 'model-b']}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    expect(screen.getByTestId('model-fetch-btn')).toBeDefined();
  });

  it('fetches models when fetch button is clicked', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['fetched-model-1', 'fetched-model-2']);

    render(
      <ModelCombobox
        value=""
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
        onFetchModels={fetchFn}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    const fetchBtn = screen.getByTestId('model-fetch-btn');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    // Fetched models should now be in the list
    await waitFor(() => {
      expect(screen.getByTitle('fetched-model-1')).toBeDefined();
      expect(screen.getByTitle('fetched-model-2')).toBeDefined();
    });
  });

  it('supports pasting arbitrary text', () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value=""
        onChange={onChange}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    // Simulating paste by directly changing input value
    fireEvent.change(input, { target: { value: 'custom/pasted-model-id' } });

    expect(onChange).toHaveBeenCalledWith('custom/pasted-model-id');
  });

  it('closes dropdown on Escape key', () => {
    render(
      <ModelCombobox
        value=""
        onChange={vi.fn()}
        presetModels={PRESET_MODELS}
      />
    );

    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);
    expect(screen.getByTestId('model-combobox-dropdown')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('model-combobox-dropdown')).toBeNull();
  });
});
