import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Road, RoadSignal } from '../../../services/platform';
import { useProjectStore } from '../../../stores/projectStore';
import { showConfirm } from '../../../utils/dialog';
import { SignalPropertiesCard } from './SignalPropertiesCard';

vi.mock('../../../utils/dialog', () => ({
  showConfirm: vi.fn().mockResolvedValue(true),
}));

function makeSignal(overrides: Partial<RoadSignal> = {}): RoadSignal {
  return {
    id: 'sig-1',
    name: 'stop-sign',
    s: 10,
    t: 2,
    z_offset: 0,
    h_offset: 0,
    width: 1,
    height: 1,
    signal_type: 'stop',
    signal_subtype: '-1',
    value: null,
    orientation: '+',
    is_dynamic: false,
    ...overrides,
  };
}

function makeRoad(): Road {
  return {
    id: 'r-1',
    name: 'r-1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [],
    signals: [],
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

function loadProject(signal: RoadSignal) {
  const road = makeRoad();
  act(() => {
    useProjectStore.getState().reset();
    useProjectStore.setState({ project: makeProject(road) });
  });
  return { road, signal };
}

describe('SignalPropertiesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(showConfirm).mockResolvedValue(true);
  });

  const renderCard = (signal: RoadSignal) => {
    const { road } = loadProject(signal);
    return render(<SignalPropertiesCard signal={signal} road={road} />);
  };

  it('renders the signal id and road id', () => {
    const signal = makeSignal();
    renderCard(signal);
    expect(screen.getByText('sig-1')).toBeInTheDocument();
    expect(screen.getByText('r-1')).toBeInTheDocument();
  });

  it('deletes the signal after confirmation', async () => {
    const signal = makeSignal();
    useProjectStore.setState((s) => ({
      project: { ...s.project, roads: [{ ...s.project.roads[0]!, signals: [signal] }] },
    }));
    render(<SignalPropertiesCard signal={signal} road={useProjectStore.getState().project.roads[0]!} />);

    vi.mocked(showConfirm).mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText('删除信号'));

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(useProjectStore.getState().project.roads[0]!.signals ?? []).toHaveLength(0),
    );
  });

  it('keeps the signal when deletion is declined', async () => {
    const signal = makeSignal();
    useProjectStore.setState((s) => ({
      project: { ...s.project, roads: [{ ...s.project.roads[0]!, signals: [signal] }] },
    }));
    render(<SignalPropertiesCard signal={signal} road={useProjectStore.getState().project.roads[0]!} />);

    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText('删除信号'));

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(useProjectStore.getState().project.roads[0]!.signals).toHaveLength(1);
  });
});
