import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Road } from '../../../services/platform';
import { ToolsMenu } from './ToolsMenu';

const pluginStoreState = vi.hoisted(() => ({
  panelTabVisibility: { 'panel-one': true, 'panel-two': false },
  togglePanel: vi.fn(),
  panels: [
    { id: 'panel-one', pluginId: 'plugin', title: 'Panel One', titleKey: 'panel.one', component: () => null, position: 'float' },
    { id: 'panel-two', pluginId: 'plugin', title: 'Panel Two', component: () => null, position: 'float' },
  ],
}));

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: (selector: (state: typeof pluginStoreState) => unknown) => selector(pluginStoreState),
}));

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
  'menu.tools': 'Tools',
  'menu.calculateRoadLength': 'Calculate road length',
  'toolbar.snap': 'Snap',
  'measurement.distance': 'Distance',
  'measurement.angle': 'Angle',
  'measurement.area': 'Area',
  'panel.one': 'Panel One',
  'plugin.customTool': 'Custom Tool',
}[key] ?? key);

const interactionProps = {
  isActive: true,
  hoveredSubItem: null,
  onHover: vi.fn(),
  onToggle: vi.fn(),
  onSubItemHover: vi.fn(),
  onClose: vi.fn(),
};

function makeProject(roads: Road[] = []): Project {
  return {
    name: 'Test',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('ToolsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tool items, panel toggles, and triggers actions on click', () => {
    const onCalculateRoadLength = vi.fn();
    const onToggleSnap = vi.fn();
    const onMeasureDistance = vi.fn();
    const onMeasureAngle = vi.fn();
    const onMeasureArea = vi.fn();
    const onPluginTool = vi.fn();

    render(
      <ToolsMenu
        {...interactionProps}
        t={t}
        project={makeProject([{ id: 'r1', name: 'Road 1', length: 1, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [], lane_sections: [] }])}
        toolsPluginItems={[{ id: 'custom-tool', pluginId: 'plugin', menu: 'tools', labelKey: 'plugin.customTool', onClick: onPluginTool }]}
        snapEnabled={true}
        onCalculateRoadLength={onCalculateRoadLength}
        onToggleSnap={onToggleSnap}
        onMeasureDistance={onMeasureDistance}
        onMeasureAngle={onMeasureAngle}
        onMeasureArea={onMeasureArea}
      />,
    );

    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculate road length' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute('data-checked', 'true');
    expect(screen.getByRole('button', { name: 'Panel One' })).toHaveAttribute('data-checked', 'true');
    expect(screen.getByRole('button', { name: 'Panel Two' })).toHaveAttribute('data-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Calculate road length' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Angle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Area' }));
    fireEvent.click(screen.getByRole('button', { name: 'Panel One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom Tool' }));

    expect(onCalculateRoadLength).toHaveBeenCalledTimes(1);
    expect(onToggleSnap).toHaveBeenCalledTimes(1);
    expect(onMeasureDistance).toHaveBeenCalledTimes(1);
    expect(onMeasureAngle).toHaveBeenCalledTimes(1);
    expect(onMeasureArea).toHaveBeenCalledTimes(1);
    expect(pluginStoreState.togglePanel).toHaveBeenCalledWith('panel-one');
    expect(onPluginTool).toHaveBeenCalledTimes(1);
  });

  it('disables road-length calculation when there are no roads', () => {
    render(
      <ToolsMenu
        {...interactionProps}
        t={t}
        project={makeProject()}
        toolsPluginItems={[]}
        snapEnabled={false}
        onCalculateRoadLength={vi.fn()}
        onToggleSnap={vi.fn()}
        onMeasureDistance={vi.fn()}
        onMeasureAngle={vi.fn()}
        onMeasureArea={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Calculate road length' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute('data-checked', 'false');
  });
});
