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
    installPlugin: vi.fn().mockResolvedValue(undefined),
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

  it('does not render when open is false', () => {
    mockUsePlugins();
    render(<PluginManager open={false} onClose={() => {}} />);
    expect(screen.queryByText('插件管理')).not.toBeInTheDocument();
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

  it('shows available plugins on the Available tab', () => {
    mockUsePlugins({
      plugins: [makePlugin({ id: 'available.plugin', name: 'Available Plugin', status: 'available', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    expect(screen.getByText('Available Plugin')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByTitle('加载')).toBeInTheDocument();
  });

  it('shows installed plugins on the Installed tab', () => {
    mockUsePlugins({
      plugins: [makePlugin({ id: 'loaded.plugin', name: 'Loaded Plugin', status: 'loaded', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByRole('tab', { name: /已安装/ }));

    expect(screen.getByText('Loaded Plugin')).toBeInTheDocument();
    expect(screen.getByTitle('卸载')).toBeInTheDocument();
    expect(screen.getByTitle('禁用')).toBeInTheDocument();
  });

  it('shows disabled plugins on the Disabled tab', () => {
    mockUsePlugins({
      plugins: [makePlugin({ id: 'disabled.plugin', name: 'Disabled Plugin', status: 'disabled', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByRole('tab', { name: /已禁用/ }));

    expect(screen.getByText('Disabled Plugin')).toBeInTheDocument();
    expect(screen.getByTitle('启用')).toBeInTheDocument();
  });

  it('triggers load action from Available tab', async () => {
    const hookValue = mockUsePlugins({
      plugins: [makePlugin({ id: 'available.plugin', name: 'Available Plugin', status: 'available', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByTitle('刷新'));
    fireEvent.click(screen.getByTitle('加载'));

    await waitFor(() => {
      expect(hookValue.refresh).toHaveBeenCalled();
      expect(hookValue.loadPlugin).toHaveBeenCalledWith('available.plugin');
    });
  });

  it('triggers unload action from Installed tab', async () => {
    const hookValue = mockUsePlugins({
      plugins: [makePlugin({ id: 'loaded.plugin', name: 'Loaded Plugin', status: 'loaded', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByRole('tab', { name: /已安装/ }));
    fireEvent.click(screen.getByTitle('卸载'));

    await waitFor(() => {
      expect(hookValue.unloadPlugin).toHaveBeenCalledWith('loaded.plugin');
    });
  });

  it('triggers enable action from Disabled tab', async () => {
    const hookValue = mockUsePlugins({
      plugins: [makePlugin({ id: 'disabled.plugin', name: 'Disabled Plugin', status: 'disabled', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByRole('tab', { name: /已禁用/ }));
    fireEvent.click(screen.getByTitle('启用'));

    await waitFor(() => {
      expect(hookValue.enablePlugin).toHaveBeenCalledWith('disabled.plugin');
    });
  });

  it('triggers disable action from Installed tab', async () => {
    const hookValue = mockUsePlugins({
      plugins: [makePlugin({ id: 'loaded.plugin', name: 'Loaded Plugin', status: 'loaded', dependencies: [], permissions: [] })],
    });

    render(<PluginManager />);

    fireEvent.click(screen.getByRole('tab', { name: /已安装/ }));
    fireEvent.click(screen.getByTitle('禁用'));

    await waitFor(() => {
      expect(hookValue.disablePlugin).toHaveBeenCalledWith('loaded.plugin');
    });
  });

  it('renders hook errors', () => {
    mockUsePlugins({ error: 'plugin registry unavailable' });

    render(<PluginManager />);

    expect(screen.getByText('plugin registry unavailable')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    mockUsePlugins();
    render(<PluginManager open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });
});
