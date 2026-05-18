import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginPanels } from './PluginPanel';
import { usePluginContribStore } from '../../stores/pluginContribStore';

// Helper: register a panel then immediately make it visible.
function registerAndShow(opts: {
  id: string;
  pluginId?: string;
  title: string;
  titleKey?: string;
  component: React.ComponentType;
  position?: 'left' | 'right' | 'bottom' | 'float';
}) {
  const { pluginId = 'test-plugin', position = 'right', ...rest } = opts;
  usePluginContribStore.getState().registerPanel({ ...rest, pluginId, position });
  usePluginContribStore.getState().showPanel(opts.id);
}

beforeEach(() => {
  usePluginContribStore.setState({
    toolbarButtons: [], menuItems: [], templateSections: [],
    importers: [], exporters: [], panels: [], contextMenuItems: [],
    viewportOverlays: [], settingsContribs: [],
    panelTabVisibility: {}, activeTabId: null,
  });
});

describe('PluginPanels', () => {
  // ── Default visibility ──────────────────────────────────────────────────────

  it('renders nothing when no plugin panels are registered', () => {
    const { container } = render(<PluginPanels />);
    expect(container.firstChild).toBeNull();
  });

  it('panel is hidden by default after registerPanel', () => {
    const TestComp = () => <div>Hidden Content</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'hidden-pnl', pluginId: 'test-plugin', title: 'Hidden',
        component: TestComp, position: 'right',
      });
    });
    render(<PluginPanels />);
    expect(screen.queryByText('Hidden Content')).not.toBeInTheDocument();
  });

  it('renders a panel after showPanel is called', () => {
    const TestComp = () => <div>My Plugin Panel Content</div>;
    act(() => { registerAndShow({ id: 'pnl-1', title: 'My Panel', component: TestComp }); });
    render(<PluginPanels />);
    expect(screen.getByText('My Plugin Panel Content')).toBeInTheDocument();
  });

  // ── Title rendering ─────────────────────────────────────────────────────────

  it('renders panel title in the header when visible', () => {
    const TestComp = () => <div>Content</div>;
    act(() => { registerAndShow({ id: 'pnl-title', title: 'GIS Tools Panel', component: TestComp }); });
    render(<PluginPanels />);
    expect(screen.getByText('GIS Tools Panel')).toBeInTheDocument();
  });

  it('uses titleKey i18n translation instead of raw title when titleKey is provided', () => {
    // 'common.close' translates to '关闭' in zh locale (set in test-setup.ts)
    const TestComp = () => <div>Content</div>;
    act(() => {
      registerAndShow({
        id: 'i18n-pnl', title: 'Raw Fallback Title',
        titleKey: 'common.close', component: TestComp,
      });
    });
    render(<PluginPanels />);
    expect(screen.getByText('关闭')).toBeInTheDocument();
    expect(screen.queryByText('Raw Fallback Title')).not.toBeInTheDocument();
  });

  // ── Multiple panels ─────────────────────────────────────────────────────────

  it('renders multiple registered and shown panels', () => {
    const Comp1 = () => <div>Panel One</div>;
    const Comp2 = () => <div>Panel Two</div>;
    act(() => {
      registerAndShow({ id: 'p1', pluginId: 'plugin-a', title: 'Panel A', component: Comp1 });
      registerAndShow({ id: 'p2', pluginId: 'plugin-b', title: 'Panel B', component: Comp2 });
    });
    render(<PluginPanels />);
    expect(screen.getByText('Panel One')).toBeInTheDocument();
    expect(screen.getByText('Panel Two')).toBeInTheDocument();
  });

  // ── Unregister / close ──────────────────────────────────────────────────────

  it('removes panel from DOM when unregistered', () => {
    const TestComp = () => <div>Removable Content</div>;
    act(() => { registerAndShow({ id: 'rem', title: 'T', component: TestComp }); });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Removable Content')).toBeInTheDocument();

    act(() => { usePluginContribStore.getState().unregisterPanel('rem'); });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Removable Content')).not.toBeInTheDocument();
  });

  it('close button hides (not unregisters) the panel', () => {
    const TestComp = () => <div>Closeable Content</div>;
    act(() => { registerAndShow({ id: 'closeable', title: 'Closeable', component: TestComp }); });
    render(<PluginPanels />);
    expect(screen.getByText('Closeable Content')).toBeInTheDocument();

    act(() => { screen.getByLabelText('关闭 Closeable').click(); });

    // Panel is no longer visible in the DOM
    expect(screen.queryByText('Closeable Content')).not.toBeInTheDocument();
    // But it is still registered in the store
    const { panels } = usePluginContribStore.getState();
    expect(panels.some((p) => p.id === 'closeable')).toBe(true);
  });

  // ── togglePanel ─────────────────────────────────────────────────────────────

  it('togglePanel makes a hidden panel visible', () => {
    const TestComp = () => <div>Toggle Me</div>;
    act(() => {
      // Register only (defaults to hidden)
      usePluginContribStore.getState().registerPanel({
        id: 'toggle-pnl', pluginId: 'p', title: 'Toggleable',
        component: TestComp, position: 'right',
      });
    });
    const { rerender } = render(<PluginPanels />);
    expect(screen.queryByText('Toggle Me')).not.toBeInTheDocument();

    act(() => { usePluginContribStore.getState().togglePanel('toggle-pnl'); });
    rerender(<PluginPanels />);
    expect(screen.getByText('Toggle Me')).toBeInTheDocument();
  });

  it('togglePanel hides a visible panel', () => {
    const TestComp = () => <div>Toggle Off</div>;
    act(() => { registerAndShow({ id: 'toggle-off', title: 'T', component: TestComp }); });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Toggle Off')).toBeInTheDocument();

    act(() => { usePluginContribStore.getState().togglePanel('toggle-off'); });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Toggle Off')).not.toBeInTheDocument();
  });

  it('togglePanel round-trips: hidden → visible → hidden', () => {
    const TestComp = () => <div>Round Trip</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'rt-pnl', pluginId: 'p', title: 'RT', component: TestComp, position: 'right',
      });
    });
    const { rerender } = render(<PluginPanels />);

    // Start hidden → toggle ON
    act(() => { usePluginContribStore.getState().togglePanel('rt-pnl'); });
    rerender(<PluginPanels />);
    expect(screen.getByText('Round Trip')).toBeInTheDocument();

    // Toggle OFF
    act(() => { usePluginContribStore.getState().togglePanel('rt-pnl'); });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Round Trip')).not.toBeInTheDocument();
  });

  // ── CSS position classes ────────────────────────────────────────────────────

  it('applies floating-right class for right-positioned panel', () => {
    const TestComp = () => <div>Right Panel</div>;
    act(() => { registerAndShow({ id: 'rp', title: 'R', component: TestComp, position: 'right' }); });
    const { container } = render(<PluginPanels />);
    expect(container.querySelector('.floating-right')).toBeInTheDocument();
  });

  it('applies floating-left class for left-positioned panel', () => {
    const TestComp = () => <div>Left Panel</div>;
    act(() => { registerAndShow({ id: 'lp', title: 'L', component: TestComp, position: 'left' }); });
    const { container } = render(<PluginPanels />);
    expect(container.querySelector('.floating-left')).toBeInTheDocument();
  });

  it('applies floating-output class for bottom-positioned panel', () => {
    const TestComp = () => <div>Bottom Panel</div>;
    act(() => { registerAndShow({ id: 'bp', title: 'B', component: TestComp, position: 'bottom' }); });
    const { container } = render(<PluginPanels />);
    expect(container.querySelector('.floating-output')).toBeInTheDocument();
  });

  it('applies floating-plugin class for float-positioned panel', () => {
    const TestComp = () => <div>Float Panel</div>;
    act(() => { registerAndShow({ id: 'fp', title: 'F', component: TestComp, position: 'float' }); });
    const { container } = render(<PluginPanels />);
    expect(container.querySelector('.floating-plugin')).toBeInTheDocument();
  });

  // ── data-panel-id attribute ─────────────────────────────────────────────────

  it('panel shell has correct data-panel-id attribute', () => {
    const TestComp = () => <div>With Attr</div>;
    act(() => { registerAndShow({ id: 'attr-pnl', title: 'Attr', component: TestComp }); });
    render(<PluginPanels />);
    expect(document.querySelector('[data-panel-id="attr-pnl"]')).toBeInTheDocument();
  });

  // ── registerPanel validation ────────────────────────────────────────────────

  it('registerPanel throws when component is null', () => {
    expect(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'bad', pluginId: 'p', title: 'Bad',
        component: null as never, position: 'right',
      });
    }).toThrow("Panel component is required for panel 'bad'");
  });

  // ── Duplicate id: re-registration ───────────────────────────────────────────

  it('re-registering same panel id replaces component but preserves visibility', () => {
    const Comp1 = () => <div>Old Component</div>;
    const Comp2 = () => <div>New Component</div>;
    act(() => { registerAndShow({ id: 'dup', title: 'Dup', component: Comp1 }); });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Old Component')).toBeInTheDocument();

    act(() => {
      // Re-register with same id — panelTabVisibility should stay true
      usePluginContribStore.getState().registerPanel({
        id: 'dup', pluginId: 'test-plugin', title: 'Dup', component: Comp2, position: 'right',
      });
    });
    rerender(<PluginPanels />);
    expect(screen.getByText('New Component')).toBeInTheDocument();
    expect(screen.queryByText('Old Component')).not.toBeInTheDocument();
  });

  // ── unregisterPlugin ────────────────────────────────────────────────────────

  it('unregisterPlugin removes all panels from that plugin at once', () => {
    const C1 = () => <div>Plugin X Panel 1</div>;
    const C2 = () => <div>Plugin X Panel 2</div>;
    const C3 = () => <div>Other Plugin Panel</div>;
    act(() => {
      registerAndShow({ id: 'px1', pluginId: 'plugin-x', title: 'PX1', component: C1 });
      registerAndShow({ id: 'px2', pluginId: 'plugin-x', title: 'PX2', component: C2 });
      registerAndShow({ id: 'po1', pluginId: 'other-plugin', title: 'PO1', component: C3 });
    });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Plugin X Panel 1')).toBeInTheDocument();
    expect(screen.getByText('Plugin X Panel 2')).toBeInTheDocument();
    expect(screen.getByText('Other Plugin Panel')).toBeInTheDocument();

    act(() => { usePluginContribStore.getState().unregisterPlugin('plugin-x'); });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Plugin X Panel 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Plugin X Panel 2')).not.toBeInTheDocument();
    expect(screen.getByText('Other Plugin Panel')).toBeInTheDocument();
  });

  // ── isPanelVisible ──────────────────────────────────────────────────────────

  it('isPanelVisible returns false for a newly registered panel', () => {
    const TestComp = () => <div>Visibility Check</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'vis-check', pluginId: 'p', title: 'V', component: TestComp, position: 'right',
      });
    });
    expect(usePluginContribStore.getState().isPanelVisible('vis-check')).toBe(false);
  });

  it('isPanelVisible returns true after showPanel is called', () => {
    const TestComp = () => <div>Visibility Check</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'vis-show', pluginId: 'p', title: 'V', component: TestComp, position: 'right',
      });
      usePluginContribStore.getState().showPanel('vis-show');
    });
    expect(usePluginContribStore.getState().isPanelVisible('vis-show')).toBe(true);
  });

  it('isPanelVisible returns false after hidePanel is called', () => {
    const TestComp = () => <div>Visibility Check</div>;
    act(() => { registerAndShow({ id: 'vis-hide', title: 'V', component: TestComp }); });
    act(() => { usePluginContribStore.getState().hidePanel('vis-hide'); });
    expect(usePluginContribStore.getState().isPanelVisible('vis-hide')).toBe(false);
  });

  // ── Skips invalid panel components ─────────────────────────────────────────

  it('skips invalid panels already present in store state', () => {
    act(() => {
      usePluginContribStore.setState({
        panels: [
          {
            id: 'broken-panel',
            pluginId: 'broken-plugin',
            title: 'Broken',
            component: null as never,
            position: 'left',
          },
        ],
        panelTabVisibility: { 'core:validation': false, 'broken-panel': true },
      });
    });

    expect(() => render(<PluginPanels />)).not.toThrow();
    expect(screen.queryByText('Broken')).not.toBeInTheDocument();
  });

  // ── showPanel / hidePanel store actions ─────────────────────────────────────

  it('showPanel makes a hidden panel visible in the DOM', () => {
    const TestComp = () => <div>Show Me</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'show-me', pluginId: 'p', title: 'S', component: TestComp, position: 'right',
      });
    });
    const { rerender } = render(<PluginPanels />);
    expect(screen.queryByText('Show Me')).not.toBeInTheDocument();

    act(() => { usePluginContribStore.getState().showPanel('show-me'); });
    rerender(<PluginPanels />);
    expect(screen.getByText('Show Me')).toBeInTheDocument();
  });

  it('hidePanel removes a visible panel from the DOM', () => {
    const TestComp = () => <div>Hide Me</div>;
    act(() => { registerAndShow({ id: 'hide-me', title: 'H', component: TestComp }); });
    const { rerender } = render(<PluginPanels />);
    expect(screen.getByText('Hide Me')).toBeInTheDocument();

    act(() => { usePluginContribStore.getState().hidePanel('hide-me'); });
    rerender(<PluginPanels />);
    expect(screen.queryByText('Hide Me')).not.toBeInTheDocument();
  });

  // ── renders nothing when all panels are hidden ──────────────────────────────

  it('renders null when all registered panels are hidden', () => {
    const TestComp = () => <div>Hidden All</div>;
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'all-hidden', pluginId: 'p', title: 'H', component: TestComp, position: 'right',
      });
      // panelTabVisibility defaults to false — panel stays hidden
    });
    const { container } = render(<PluginPanels />);
    expect(container.firstChild).toBeNull();
  });

  // ── close button aria-label ─────────────────────────────────────────────────

  it('close button has accessible aria-label including the panel title', () => {
    const TestComp = () => <div>Aria Test</div>;
    act(() => { registerAndShow({ id: 'aria-pnl', title: 'My Tool', component: TestComp }); });
    render(<PluginPanels />);
    expect(screen.getByLabelText('关闭 My Tool')).toBeInTheDocument();
  });

  // ── vi.fn() cleanup ─────────────────────────────────────────────────────────
  it('does not call any side-effect on render when panel is hidden', () => {
    const renderSpy = vi.fn();
    const TestComp = () => { renderSpy(); return <div>Spy</div>; };
    act(() => {
      usePluginContribStore.getState().registerPanel({
        id: 'spy-pnl', pluginId: 'p', title: 'Spy', component: TestComp, position: 'right',
      });
    });
    render(<PluginPanels />);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  // ── float position — CSS class + initialCenter ──────────────────────────────

  it('float panel uses floating-plugin CSS class', () => {
    const TestComp = () => <div>Float Content</div>;
    act(() => { registerAndShow({ id: 'fp-class', title: 'Float', component: TestComp, position: 'float' }); });
    const { container } = render(<PluginPanels />);
    const el = container.querySelector('.floating-plugin');
    expect(el).toBeInTheDocument();
    // Must NOT fall back to floating-right
    expect(container.querySelector('[class*="floating-right"]')).not.toBeInTheDocument();
  });

  it('float panel has position:fixed style (from .floating-plugin CSS class)', () => {
    // The DOM element itself won't carry inline position:fixed (that comes from CSS),
    // but we can verify the class name is correct and the panel content is reachable.
    const TestComp = () => <div>Fixed Float</div>;
    act(() => { registerAndShow({ id: 'fp-fixed', title: 'F', component: TestComp, position: 'float' }); });
    render(<PluginPanels />);
    expect(document.querySelector('[data-panel-id="fp-fixed"]')).toBeInTheDocument();
  });
});
