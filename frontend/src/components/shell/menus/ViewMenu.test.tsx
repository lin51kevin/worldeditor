import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewMenu } from './ViewMenu';

vi.mock('./MenuSection', () => ({
  MenuSection: ({ menu }: { menu: { label: string; items: Array<{ label: string; action?: () => void; disabled?: boolean; checked?: boolean; separator?: boolean }> } }) => (
    <div>
      <h1>{menu.label}</h1>
      {menu.items.map((item, index) =>
        item.separator ? (
          <div key={index} data-testid="separator" />
        ) : (
          <button
            key={index}
            type="button"
            data-checked={item.checked === undefined ? 'unset' : String(item.checked)}
            disabled={item.disabled}
            onClick={() => void item.action?.()}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  ),
}));

const t = (key: string) => ({
  'menu.view': 'View',
  'menu.view3D': 'View 3D',
  'menu.view2D': 'View 2D',
  'menu.zoomToFit': 'Zoom to Fit',
  'menu.zoomToSelected': 'Zoom to Selected',
  'menu.showGrid': 'Show Grid',
  'menu.showAxis': 'Show Axis',
  'menu.showHoverHighlight': 'Show Hover Highlight',
  'menu.showLayerPanel': 'Show Layer Panel',
  'menu.showPropertyPanel': 'Show Property Panel',
  'menu.showTemplatePanel': 'Show Template Panel',
  'menu.resetPanels': 'Reset Panels',
  'plugin.extraView': 'Extra View Action',
}[key] ?? key);

const interactionProps = {
  isActive: true,
  hoveredSubItem: null,
  onHover: vi.fn(),
  onToggle: vi.fn(),
  onSubItemHover: vi.fn(),
  onClose: vi.fn(),
};

describe('ViewMenu', () => {
  it('renders view options with correct checkmarks and triggers actions', () => {
    const onView3D = vi.fn();
    const onView2D = vi.fn();
    const onZoomToFit = vi.fn();
    const onZoomToSelected = vi.fn();
    const onToggleGrid = vi.fn();
    const onToggleAxis = vi.fn();
    const onToggleHoverHighlight = vi.fn();
    const onToggleLeftPanel = vi.fn();
    const onToggleRightPanel = vi.fn();
    const onToggleTemplatePanel = vi.fn();
    const onResetPanels = vi.fn();
    const onPluginView = vi.fn();

    render(
      <ViewMenu
        {...interactionProps}
        t={t}
        viewPluginItems={[{ id: 'extra-view', pluginId: 'plugin', menu: 'view', labelKey: 'plugin.extraView', onClick: onPluginView }]}
        dimension="3d"
        showGrid={true}
        showAxis={false}
        showHoverHighlight={true}
        leftCollapsed={false}
        rightCollapsed={true}
        templatePanelCollapsed={true}
        templatePluginEnabled={true}
        onView3D={onView3D}
        onView2D={onView2D}
        onZoomToFit={onZoomToFit}
        onZoomToSelected={onZoomToSelected}
        onToggleGrid={onToggleGrid}
        onToggleAxis={onToggleAxis}
        onToggleHoverHighlight={onToggleHoverHighlight}
        onToggleLeftPanel={onToggleLeftPanel}
        onToggleRightPanel={onToggleRightPanel}
        onToggleTemplatePanel={onToggleTemplatePanel}
        onResetPanels={onResetPanels}
      />,
    );

    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View 3D' })).toHaveAttribute('data-checked', 'true');
    expect(screen.getByRole('button', { name: 'View 2D' })).toHaveAttribute('data-checked', 'false');
    expect(screen.getByRole('button', { name: 'Show Grid' })).toHaveAttribute('data-checked', 'true');
    expect(screen.getByRole('button', { name: 'Show Axis' })).toHaveAttribute('data-checked', 'false');
    expect(screen.getByRole('button', { name: 'Show Layer Panel' })).toHaveAttribute('data-checked', 'true');
    expect(screen.getByRole('button', { name: 'Show Property Panel' })).toHaveAttribute('data-checked', 'false');
    expect(screen.getByRole('button', { name: 'Show Template Panel' })).toHaveAttribute('data-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'View 3D' }));
    fireEvent.click(screen.getByRole('button', { name: 'View 2D' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to Fit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to Selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Grid' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Axis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Hover Highlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Layer Panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Property Panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Template Panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Panels' }));
    fireEvent.click(screen.getByRole('button', { name: 'Extra View Action' }));

    expect(onView3D).toHaveBeenCalledTimes(1);
    expect(onView2D).toHaveBeenCalledTimes(1);
    expect(onZoomToFit).toHaveBeenCalledTimes(1);
    expect(onZoomToSelected).toHaveBeenCalledTimes(1);
    expect(onToggleGrid).toHaveBeenCalledTimes(1);
    expect(onToggleAxis).toHaveBeenCalledTimes(1);
    expect(onToggleHoverHighlight).toHaveBeenCalledTimes(1);
    expect(onToggleLeftPanel).toHaveBeenCalledTimes(1);
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
    expect(onToggleTemplatePanel).toHaveBeenCalledTimes(1);
    expect(onResetPanels).toHaveBeenCalledTimes(1);
    expect(onPluginView).toHaveBeenCalledTimes(1);
  });

  it('disables the template panel toggle when the template plugin is unavailable', () => {
    render(
      <ViewMenu
        {...interactionProps}
        t={t}
        viewPluginItems={[]}
        dimension="2d"
        showGrid={false}
        showAxis={false}
        showHoverHighlight={false}
        leftCollapsed={true}
        rightCollapsed={true}
        templatePanelCollapsed={false}
        templatePluginEnabled={false}
        onView3D={vi.fn()}
        onView2D={vi.fn()}
        onZoomToFit={vi.fn()}
        onZoomToSelected={vi.fn()}
        onToggleGrid={vi.fn()}
        onToggleAxis={vi.fn()}
        onToggleHoverHighlight={vi.fn()}
        onToggleLeftPanel={vi.fn()}
        onToggleRightPanel={vi.fn()}
        onToggleTemplatePanel={vi.fn()}
        onResetPanels={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Show Template Panel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View 2D' })).toHaveAttribute('data-checked', 'true');
  });
});
