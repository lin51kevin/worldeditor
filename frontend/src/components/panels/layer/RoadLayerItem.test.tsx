import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Road } from '../../../services/platform';
import { makeLaneSectionKey, type SceneNodeSelection } from '../../../utils/sceneGraph';
import { RoadLayerItem, type RoadLayerItemProps } from './RoadLayerItem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'layerPanel.zoomTo': 'Zoom to',
      'layerPanel.hideRoad': 'Hide road',
      'layerPanel.showRoad': 'Show road',
      'layerPanel.laneSection': 'Lane Section',
      'layerPanel.hideLaneSection': 'Hide lane section',
      'layerPanel.showLaneSection': 'Show lane section',
      'layerPanel.lane': 'Lane',
      'layerPanel.hideLane': 'Hide lane',
      'layerPanel.showLane': 'Show lane',
      'layerPanel.roadSignals': 'Signals',
      'layerPanel.roadObjects': 'Objects',
    }[key] ?? key),
  }),
}));

function makeRoad(): Road {
  return {
    id: 'road-1',
    name: 'Main Road',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [
      {
        s: 0,
        single_side: false,
        left: [{ id: 2, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
        center: [{ id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] }],
        right: [{ id: -1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
      },
    ],
    signals: [{ id: 'sig-1', name: 'Speed Sign', s: 10, t: 0, z_offset: 0, h_offset: 0, width: 1, height: 1, signal_type: 'Speed', signal_subtype: 'Limit', value: null, orientation: '+', is_dynamic: false }],
    objects: [{ id: 'obj-1', object_type: 'Barrier', name: 'Barrier A', position: { x: 0, y: 0, z: 0, id: null }, orientation: 0, hdg: 0, width: 1, height: 1, length: 2, corners: [], validity: null }],
  };
}

function createProps(overrides: Partial<RoadLayerItemProps> = {}) {
  const callbacks = {
    onSelect: vi.fn(),
    onToggleExpand: vi.fn(),
    onZoom: vi.fn(),
    onToggleVisibility: vi.fn(),
    onSelectLaneSection: vi.fn(),
    onToggleLaneSectionExpand: vi.fn(),
    onToggleLaneSectionVisibility: vi.fn(),
    onSelectLane: vi.fn(),
    onToggleLaneVisibility: vi.fn(),
    onToggleSignalsExpand: vi.fn(),
    onSelectSignal: vi.fn(),
    onToggleSignalVisibility: vi.fn(),
    onToggleObjectsExpand: vi.fn(),
    onSelectObject: vi.fn(),
    onToggleObjectVisibility: vi.fn(),
  };

  const props: RoadLayerItemProps = {
    road: makeRoad(),
    selectedSceneNode: null,
    isSelected: false,
    isVisible: true,
    isExpanded: false,
    signalsExpanded: false,
    objectsExpanded: false,
    laneSectionsExpanded: new Set<string>(),
    isLaneSectionSelected: () => false,
    isLaneSelected: () => false,
    isLaneSectionVisible: () => true,
    isLaneVisible: () => true,
    isSignalVisible: () => true,
    isObjectVisible: () => true,
    ...callbacks,
    ...overrides,
  };

  return { callbacks, props };
}

function renderRoadItem(overrides: Partial<RoadLayerItemProps> = {}) {
  const { callbacks, props } = createProps(overrides);
  return { callbacks, props, ...render(<RoadLayerItem {...props} />) };
}

describe('RoadLayerItem', () => {
  it('renders the road name, selection state, and top-level actions', () => {
    const { callbacks, container } = renderRoadItem({ isSelected: true });

    expect(screen.getByText('Main Road')).toBeInTheDocument();
    expect(screen.getByText('(road-1)')).toBeInTheDocument();
    expect(screen.getByText('Main Road').closest('.layer-item')).toHaveClass('selected');

    fireEvent.click(screen.getByText('Main Road'));
    fireEvent.click(screen.getByTitle('Zoom to'));
    fireEvent.click(screen.getByTitle('Hide road'));

    expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
    expect(callbacks.onZoom).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleVisibility).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.road-expand')).toBeInTheDocument();
  });

  it('shows lane sections and lanes when expanded and routes selection callbacks', () => {
    const laneSectionKey = makeLaneSectionKey('road-1', 0);
    const selectedSceneNode: SceneNodeSelection = {
      type: 'lane',
      roadId: 'road-1',
      sectionIndex: 0,
      side: 'left',
      laneId: 2,
    };
    const { callbacks, container } = renderRoadItem({
      isExpanded: true,
      laneSectionsExpanded: new Set([laneSectionKey]),
      selectedSceneNode,
      isLaneSectionSelected: (sectionIndex) => sectionIndex === 0,
      isLaneSelected: (sectionIndex, side, laneId) => sectionIndex === 0 && side === 'left' && laneId === 2,
    });

    expect(screen.getByText('Lane Section #1')).toBeInTheDocument();
    expect(screen.getByText(/\(s=0.0\)/)).toBeInTheDocument();
    expect(screen.getByText('Lane L2').closest('.layer-item')).toHaveClass('selected');

    fireEvent.click(container.querySelector('.road-list-entry > .layer-item .road-expand') as HTMLElement);
    fireEvent.click(screen.getByText('Lane Section #1'));
    fireEvent.click((container.querySelector('.road-detail-lane-section .road-expand') as HTMLElement));
    fireEvent.click(screen.getByText('Lane L2'));
    fireEvent.click(screen.getByTitle('Hide lane section'));
    fireEvent.click(screen.getAllByTitle('Hide lane')[0] as HTMLElement);

    expect(callbacks.onToggleExpand).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectLaneSection).toHaveBeenCalledWith(0);
    expect(callbacks.onToggleLaneSectionExpand).toHaveBeenCalledWith(0);
    expect(callbacks.onSelectLane).toHaveBeenCalledWith(0, 'left', 2);
    expect(callbacks.onToggleLaneSectionVisibility).toHaveBeenCalledWith(0);
    expect(callbacks.onToggleLaneVisibility).toHaveBeenCalledWith(0, 'left', 2);
  });

  it('renders signal and object groups and handles their actions', () => {
    const selectedSignal: SceneNodeSelection = { type: 'signal', roadId: 'road-1', signalId: 'sig-1' };
    const { callbacks, container, rerender } = renderRoadItem({
      isExpanded: true,
      signalsExpanded: true,
      objectsExpanded: true,
      selectedSceneNode: selectedSignal,
    });

    expect(screen.getByText('Signals')).toBeInTheDocument();
    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(screen.getByText('Speed Sign (sig-1)').closest('.layer-item')).toHaveClass('selected');
    expect(screen.getByText('Barrier A (obj-1)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Signals'));
    fireEvent.click(screen.getByText('Objects'));
    fireEvent.click(screen.getByText('Speed Sign (sig-1)'));
    fireEvent.click(screen.getByText('Barrier A (obj-1)'));
    fireEvent.click((container.querySelectorAll('.road-sub-group .road-visibility')[0] as HTMLElement));
    fireEvent.click((container.querySelectorAll('.road-sub-group .road-visibility')[1] as HTMLElement));

    expect(callbacks.onToggleSignalsExpand).toHaveBeenCalled();
    expect(callbacks.onToggleObjectsExpand).toHaveBeenCalled();
    expect(callbacks.onSelectSignal).toHaveBeenCalledWith('sig-1');
    expect(callbacks.onSelectObject).toHaveBeenCalledWith('obj-1');
    expect(callbacks.onToggleSignalVisibility).toHaveBeenCalledWith('sig-1');
    expect(callbacks.onToggleObjectVisibility).toHaveBeenCalledWith('obj-1');

    rerender(
      <RoadLayerItem
        {...createProps({
          isExpanded: true,
          signalsExpanded: true,
          objectsExpanded: true,
          selectedSceneNode: { type: 'object', roadId: 'road-1', objectId: 'obj-1' },
        }).props}
      />,
    );

    expect(screen.getByText('Barrier A (obj-1)').closest('.layer-item')).toHaveClass('selected');
  });
});
