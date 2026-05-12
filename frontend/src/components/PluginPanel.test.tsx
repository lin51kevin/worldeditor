import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginPanels } from './PluginPanel';
import { usePluginContribStore } from '../stores/pluginContribStore';

beforeEach(() => {
  usePluginContribStore.setState({
    toolbarButtons: [], menuItems: [], templateSections: [],
    importers: [], exporters: [], panels: [], contextMenuItems: [],
    viewportOverlays: [], settingsContribs: [],
  });
});

describe('PluginPanels', () => {
  it('renders nothing when no panels are registered', () => {
    const { container } = render(<PluginPanels />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a panel when one is registered', () => {
    const TestComp = () => <div>My Plugin Panel Content</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'pnl-1', pluginId: 'test-plugin', title: 'My Panel',
        component: TestComp, position: 'right',
      });
    });
    render(<PluginPanels />);
    expect(screen.getByText('My Plugin Panel Content')).toBeInTheDocument();
  });

  it('renders panel title in the header', () => {
    const TestComp = () => <div>Content</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'pnl-1', pluginId: 'test-plugin', title: 'GIS Tools Panel',
        component: TestComp, position: 'left',
      });
    });
    render(<PluginPanels />);
    expect(screen.getByText('GIS Tools Panel')).toBeInTheDocument();
  });

  it('renders multiple registered panels', () => {
    const Comp1 = () => <div>Panel One</div>;
    const Comp2 = () => <div>Panel Two</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'p1', pluginId: 'plugin-a', title: 'Panel A', component: Comp1, position: 'right',
      });
      usePluginContribStore.getState().registerPanel({
        id: 'p2', pluginId: 'plugin-b', title: 'Panel B', component: Comp2, position: 'right',
      });
    });
    render(<PluginPanels />);
    expect(screen.getByText('Panel One')).toBeInTheDocument();
    expect(screen.getByText('Panel Two')).toBeInTheDocument();
  });

  it('removes panel when unregistered', () => {
    const TestComp = () => <div>Removable Content</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'rem', pluginId: 'p', title: 'T', component: TestComp, position: 'float',
      });
    });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Removable Content')).toBeInTheDocument();

    act(() => {
      usePluginContribStore.getState().unregisterPanel('rem');
    });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Removable Content')).not.toBeInTheDocument();
  });

  it('calls onClose and removes the panel from view when close button is clicked', async () => {
    const TestComp = () => <div>Closeable Content</div>;
    const onClose = vi.fn();
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'closeable', pluginId: 'p', title: 'Closeable', component: TestComp, position: 'float',
      });
    });
    render(<PluginPanels />);
    expect(screen.getByText('Closeable Content')).toBeInTheDocument();

    // Click the close button
    const closeBtn = screen.getByLabelText('关闭 Closeable');
    act(() => { closeBtn.click(); });

    expect(screen.queryByText('Closeable Content')).not.toBeInTheDocument();
    void onClose;
  });
});
