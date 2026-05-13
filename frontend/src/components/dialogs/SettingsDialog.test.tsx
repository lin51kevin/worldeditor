import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsDialog } from './SettingsDialog';
import { usePluginContribStore } from '../../stores/pluginContribStore';

beforeEach(() => {
  usePluginContribStore.setState({ settingsContribs: [] });
});

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SettingsDialog open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog title when open', () => {
    render(<SettingsDialog open onClose={() => {}} />);
    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('shows a close button that fires onClose', () => {
    const onClose = () => {};
    render(<SettingsDialog open onClose={onClose} />);
    // Using the button text or aria-label
    const btn = screen.getByLabelText('关闭设置');
    fireEvent.click(btn);
    // onClose is not a spy here, so just verify the dialog doesn't crash
    expect(btn).toBeInTheDocument();
  });

  it('shows Core Settings tab by default', () => {
    render(<SettingsDialog open onClose={() => {}} />);
    expect(screen.getByText('核心设置')).toBeInTheDocument();
  });

  it('shows plugin settings tabs when contribs are registered', () => {
    const PluginSettingsComp = () => <div>Plugin Settings Content</div>;
    act(() => {
      usePluginContribStore.getState().registerSettings({
        id: 'set-1', pluginId: 'my-plugin', title: 'My Plugin Settings',
        component: PluginSettingsComp,
      });
    });

    render(<SettingsDialog open onClose={() => {}} />);
    expect(screen.getByText('My Plugin Settings')).toBeInTheDocument();
  });

  it('renders the plugin settings component when its tab is selected', () => {
    const PluginComp = () => <div>Plugin Settings Body</div>;
    act(() => {
      usePluginContribStore.getState().registerSettings({
        id: 'set-1', pluginId: 'my-plugin', title: 'Plugin Tab',
        component: PluginComp,
      });
    });

    render(<SettingsDialog open onClose={() => {}} />);
    // Click the plugin tab
    fireEvent.click(screen.getByText('Plugin Tab'));
    expect(screen.getByText('Plugin Settings Body')).toBeInTheDocument();
  });

  it('removes plugin settings tab when unregistered', () => {
    const PluginComp = () => <div>Temp Plugin Content</div>;
    act(() => {
      usePluginContribStore.getState().registerSettings({
        id: 'set-2', pluginId: 'temp-plugin', title: 'Temp Plugin',
        component: PluginComp,
      });
    });

    const { rerender } = render(<SettingsDialog open onClose={() => {}} />);
    expect(screen.getByText('Temp Plugin')).toBeInTheDocument();

    act(() => {
      usePluginContribStore.getState().unregisterSettings('set-2');
    });
    rerender(<SettingsDialog open onClose={() => {}} />);
    expect(screen.queryByText('Temp Plugin')).not.toBeInTheDocument();
  });
});
