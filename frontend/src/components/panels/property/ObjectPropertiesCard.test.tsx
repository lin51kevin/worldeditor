import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneSection, Project, Road, RoadObjectItem } from '../../../services/platform';
import { useProjectStore } from '../../../stores/projectStore';
import { showConfirm } from '../../../utils/dialog';
import { ObjectPropertiesCard } from './ObjectPropertiesCard';

vi.mock('../../../utils/dialog', () => ({
  showConfirm: vi.fn().mockResolvedValue(true),
}));

function makeSection(): LaneSection {
  const width = [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }];
  const link = { predecessor: null, successor: null };
  return {
    s: 0,
    single_side: false,
    left: [{ id: 1, lane_type: 'Driving', level: 0, link, width, road_marks: [] }],
    center: [{ id: 0, lane_type: 'None', level: 0, link, width: [], road_marks: [] }],
    right: [{ id: -1, lane_type: 'Driving', level: 0, link, width, road_marks: [] }],
  };
}

function makeObject(overrides: Partial<RoadObjectItem> = {}): RoadObjectItem {
  return {
    id: 'o-1',
    object_type: 'Crosswalk',
    name: 'zebra',
    position: { x: 10, y: 2, z: 0.1, id: null },
    orientation: 0,
    hdg: 0,
    width: 4,
    height: 0,
    length: 3,
    corners: [],
    validity: null,
    ...overrides,
  };
}

function makeRoad(objects: RoadObjectItem[]): Road {
  return {
    id: 'r-1',
    name: 'r-1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [makeSection()],
    objects,
  };
}

function makeProject(road: Road): Project {
  return {
    name: 'Untitled',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads: [road],
    junctions: [],
    signals: [],
    objects: [],
  };
}

function loadProject(object: RoadObjectItem) {
  act(() => {
    useProjectStore.getState().reset();
    useProjectStore.setState({ project: makeProject(makeRoad([object])) });
  });
}

const currentObject = () =>
  useProjectStore.getState().project.roads[0]!.objects!.find((o) => o.id === 'o-1')!;

const roadFrameCorners = [
  { x: 9, y: 1, z: 0, id: null },
  { x: 11, y: 1, z: 0, id: null },
  { x: 11, y: 3, z: 0, id: null },
  { x: 9, y: 3, z: 0, id: null },
];

describe('ObjectPropertiesCard', () => {
  beforeEach(() => loadProject(makeObject()));

  const renderCard = () => {
    const road = useProjectStore.getState().project.roads[0]!;
    return render(<ObjectPropertiesCard object={road.objects![0]!} road={road} roadId={road.id} />);
  };

  it('moves the object when the station field changes', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('桩号 (s) (m)'), { target: { value: '42' } });

    expect(currentObject().position.x).toBeCloseTo(42);
  });

  it('clamps the station to the road length', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('桩号 (s) (m)'), { target: { value: '999' } });

    expect(currentObject().position.x).toBeCloseTo(100);
  });

  it('moves the object laterally', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('横向偏移 (t) (m)'), { target: { value: '-3.5' } });

    expect(currentObject().position.y).toBeCloseTo(-3.5);
  });

  it('edits the z offset without touching s/t', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('高程偏移'), { target: { value: '0.5' } });

    expect(currentObject().position).toMatchObject({ x: 10, y: 2, z: 0.5 });
  });

  it('stores heading in radians when edited in degrees', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('航向角 (°)'), { target: { value: '90' } });

    expect(currentObject().hdg).toBeCloseTo(Math.PI / 2);
  });

  it('commits the name on blur', () => {
    renderCard();
    const input = screen.getByLabelText('名称');
    fireEvent.change(input, { target: { value: 'crossing' } });
    expect(currentObject().name).toBe('zebra');

    fireEvent.blur(input);
    expect(currentObject().name).toBe('crossing');
  });

  it('deletes the object after confirmation', async () => {
    vi.mocked(showConfirm).mockResolvedValueOnce(true);
    renderCard();
    fireEvent.click(screen.getByText('删除物体'));

    await waitFor(() =>
      expect(useProjectStore.getState().project.roads[0]!.objects).toHaveLength(0),
    );
  });

  it('keeps the object when deletion is declined', async () => {
    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    renderCard();
    fireEvent.click(screen.getByText('删除物体'));

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(useProjectStore.getState().project.roads[0]!.objects).toHaveLength(1);
  });

  it('keeps size inputs editable when there is no drawn outline', () => {
    renderCard();
    expect(screen.getByLabelText('长度')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('长度'), { target: { value: '7' } });

    expect(currentObject().length).toBeCloseTo(7);
  });

  describe('with a road-frame outline', () => {
    beforeEach(() => loadProject(makeObject({ corner_type: 'Road', corners: roadFrameCorners })));

    it('drags the outline along when the station changes', () => {
      renderCard();
      fireEvent.change(screen.getByLabelText('桩号 (s) (m)'), { target: { value: '20' } });

      const obj = currentObject();
      expect(obj.position.x).toBeCloseTo(20);
      expect(obj.corners.map((c) => c.x)).toEqual([19, 21, 21, 19]);
      expect(obj.corners.map((c) => c.y)).toEqual([1, 1, 3, 3]);
    });

    it('rotates the outline about the object position', () => {
      renderCard();
      fireEvent.change(screen.getByLabelText('航向角 (°)'), { target: { value: '90' } });

      const obj = currentObject();
      expect(obj.corners[0]!.x).toBeCloseTo(11);
      expect(obj.corners[0]!.y).toBeCloseTo(1);
    });

    it('disables the size inputs because the outline defines them', () => {
      renderCard();
      expect(screen.getByLabelText('长度')).toBeDisabled();
      expect(screen.getByLabelText('宽度')).toBeDisabled();
      expect(screen.getByLabelText('高度')).not.toBeDisabled();
    });
  });
});
