import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from './PluginManager';
import { usePlugins, type PluginInfo, type UsePluginsReturn } from '../hooks/usePlugins';

vi.mock('../hooks/usePlugins', () => ({
  usePlugins: vi.fn(),
}));

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'plugin.test',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'Plugin description',
    dependencies: ['dep-a'],
    permissions: ['read-files'],
    status: 'available',
    ...overrides,
  };
}

function mockUsePlugins(overrides: Partial<UsePluginsReturn> = {}) {
  const value: UsePluginsReturn = {
    plugins: [],
    loading: false,
    error: null,
    loadPlugin: vi.fn().mockResolvedValue(undefined),
    unloadPlugin: vi.fn().mockResolvedValue(undefined),
    enablePlugin: vi.fn().mockResolvedValue(undefined),
    disablePlugin: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  vi.mocked(usePlugins).mockReturnValue(value);
  return value;
}

describe('PluginManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the plugin manager header and empty state', () => {
    mockUsePlugins();

    render(<PluginManager />);

    expect(screen.getByText('插件管理')).toBeInTheDocument();
    expect(screen.getByText('暂无可用插件')).toBeInTheDocument();
    expect(screen.getByTitle('刷新')).toBeInTheDocument();
  });

  it('shows loading state when plugins are being fetched', () => {
    mockUsePlugins({ loading: true });

    render(<PluginManager />);

    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders plugin details and toggles expand/collapse', () => {
    mockUsePlugins({
      plugins: [
        makePlugin({ id: 'available.plugin', name: 'Available Plugin', status: 'available' }),
        makePlugin({ id: 'loaded.plugin', name: 'Loaded Plugin', status: 'loaded', dependencies: [], permissions: [] }),
        makePlugin({ id: 'disabled.plugin', name: 'Disabled Plugin', status: 'disabled', disabledReason: 'incompatible', dependencies: [], permissions: [] }),
      ],
    });

    render(<PluginManager />);

    expect(screen.getByText('Available Plugin')).toBeInTheDocument();
    expect(screen.getAllByText('v1.0.0')).toHaveLength(3);
    expect(screen.getByText('可用')).toBeInTheDocument();
    expect(screen.getByText('已加载')).toBeInTheDocument();
    expect(screen.getByText('已禁用')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Available Plugin'));
    expect(screen.getByText('Plugin description')).toBeInTheDocument();
    expect(screen.getByText('available.plugin')).toBeInTheDocument();
    expect(screen.getByText('dep-a')).toBeInTheDocument();
    expect(screen.getByText('read-files')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Available Plugin'));
    expect(screen.queryByText('Plugin description')).not.toBeInTheDocument();
  });

  it('refreshes and triggers load, unload, and enable actions', async () => {
    const hookValue = mockUsePlugins({
      plugins: [
        makePlugin({ id: 'available.plugin', name: 'Available Plugin', status: 'available', dependencies: [], permissions: [] }),
        makePlugin({ id: 'loaded.plugin', name: 'Loaded Plugin', status: 'loaded', dependencies: [], permissions: [] }),
        makePlugin({ id: 'disabled.plugin', name: 'Disabled Plugin', status: 'disabled', dependencies: [], permissions: [] }),
      ],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByTitle('刷新'));
    fireEvent.click(screen.getByTitle('加载'));
    fireEvent.click(screen.getByTitle('卸载'));
    fireEvent.click(screen.getByTitle('启用'));

    await waitFor(() => {
      expect(hookValue.refresh).toHaveBeenCalledTimes(1);
      expect(hookValue.loadPlugin).toHaveBeenCalledWith('available.plugin');
      expect(hookValue.unloadPlugin).toHaveBeenCalledWith('loaded.plugin');
      expect(hookValue.enablePlugin).toHaveBeenCalledWith('disabled.plugin');
    });
  });

  it('opens the disable dialog and confirms a disable reason', async () => {
    const hookValue = mockUsePlugins({
      plugins: [makePlugin({ id: 'available.plugin', name: 'Available Plugin' })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByTitle('禁用'));
    fireEvent.change(screen.getByPlaceholderText('例如：不兼容当前版本'), {
      target: { value: 'manual disable' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认禁用' }));

    await waitFor(() => {
      expect(hookValue.disablePlugin).toHaveBeenCalledWith('available.plugin', 'manual disable');
    });
    await waitFor(() => {
      expect(screen.queryByText('禁用插件')).not.toBeInTheDocument();
    });
  });

  it('renders hook errors', () => {
    mockUsePlugins({ error: 'plugin registry unavailable' });

    render(<PluginManager />);

    expect(screen.getByText('plugin registry unavailable')).toBeInTheDocument();
  });
});
