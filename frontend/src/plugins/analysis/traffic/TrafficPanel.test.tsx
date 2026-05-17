import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TrafficPanel from './TrafficPanel';
import type { Project } from '../../../services/platform';

const mockSetProject = vi.fn();
let mockProject: Project;

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ project: mockProject, setProject: mockSetProject }),
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'test',
    header: { name: 'test', rev_major: 1, rev_minor: 0, date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockSetProject.mockClear();
  mockProject = makeProject();
});

describe('TrafficPanel', () => {
  it('renders "Traffic Control" title', () => {
    render(<TrafficPanel />);
    expect(screen.getByText('Traffic Control')).toBeInTheDocument();
  });

  it('shows "Auto-Deploy Signals" button', () => {
    render(<TrafficPanel />);
    expect(screen.getByRole('button', { name: 'Auto-Deploy Signals' })).toBeInTheDocument();
  });

  it('displays correct road count from project', () => {
    mockProject = makeProject({
      roads: [
        { id: 'r1', name: 'R1', length: 100, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] },
        { id: 'r2', name: 'R2', length: 200, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] },
      ],
    });
    render(<TrafficPanel />);
    const roads = screen.getByText('Roads');
    expect(roads.nextElementSibling?.textContent).toBe('2');
  });

  it('displays zero road count on empty project', () => {
    render(<TrafficPanel />);
    const roads = screen.getByText('Roads');
    expect(roads.nextElementSibling?.textContent).toBe('0');
  });

  it('displays correct junction count from project', () => {
    mockProject = makeProject({
      junctions: [
        { id: 'j1', name: 'J1', connections: [] },
        { id: 'j2', name: 'J2', connections: [] },
      ],
    });
    render(<TrafficPanel />);
    const junctions = screen.getByText('Junctions');
    expect(junctions.nextElementSibling?.textContent).toBe('2');
  });

  it('counts signals across roads', () => {
    mockProject = makeProject({
      roads: [
        {
          id: 'r1', name: 'R1', length: 100, junction_id: null,
          link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [],
          signals: [
            { id: 's1', name: 'S1', s: 50, t: 0, z_offset: 0, h_offset: 0, width: 0.4, height: 1.2, signal_type: 'traffic_light', signal_subtype: 'default', value: null, orientation: '+', is_dynamic: true },
            { id: 's2', name: 'S2', s: 80, t: 0, z_offset: 0, h_offset: 0, width: 0.4, height: 1.2, signal_type: 'traffic_light', signal_subtype: 'default', value: null, orientation: '+', is_dynamic: true },
          ],
        },
      ],
    });
    render(<TrafficPanel />);
    // Scope to stats section to avoid ambiguity with phase-card "Signals" rows
    const statsEl = document.querySelector('.traffic-panel__stats') as HTMLElement;
    const signals = within(statsEl).getByText('Signals');
    expect(signals.nextElementSibling?.textContent).toBe('2');
  });

  it('shows empty-state when no phase suggestions', () => {
    render(<TrafficPanel />);
    expect(screen.getByText(/No phase suggestions yet/)).toBeInTheDocument();
  });

  it('clicking Auto-Deploy Signals calls setProject', () => {
    render(<TrafficPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Deploy Signals' }));
    expect(mockSetProject).toHaveBeenCalledOnce();
  });

  it('clicking Auto-Deploy Signals passes a project with roads to setProject', () => {
    mockProject = makeProject({
      roads: [
        { id: 'r1', name: 'Main St', length: 150, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] },
      ],
    });
    render(<TrafficPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Deploy Signals' }));
    const calledWith = mockSetProject.mock.calls[0]?.[0] as Project;
    expect(calledWith.roads[0]?.signals?.length).toBeGreaterThan(0);
  });

  it('renders phase cards when junctions exist', () => {
    mockProject = makeProject({
      junctions: [
        { id: 'j1', name: 'Main Junction', connections: [] },
      ],
    });
    render(<TrafficPanel />);
    expect(screen.getByText('Main Junction')).toBeInTheDocument();
    expect(screen.queryByText(/No phase suggestions yet/)).not.toBeInTheDocument();
  });

  it('phase card shows Roads / Signals / Cycle / timing rows', () => {
    mockProject = makeProject({
      junctions: [
        { id: 'j1', name: 'Cross', connections: [] },
      ],
    });
    render(<TrafficPanel />);
    // Phase card has the same labels as stats; scope to the card element
    const cardEl = document.querySelector('.traffic-panel__card') as HTMLElement;
    expect(within(cardEl).getByText('Roads')).toBeInTheDocument();
    expect(within(cardEl).getByText('Signals')).toBeInTheDocument();
    expect(within(cardEl).getByText('Cycle')).toBeInTheDocument();
    expect(within(cardEl).getByText('Green / Yellow / Red')).toBeInTheDocument();
  });

  it('Phase Plans count equals number of junctions', () => {
    mockProject = makeProject({
      junctions: [
        { id: 'j1', name: 'J1', connections: [] },
        { id: 'j2', name: 'J2', connections: [] },
      ],
    });
    render(<TrafficPanel />);
    const phasePlans = screen.getByText('Phase Plans');
    expect(phasePlans.nextElementSibling?.textContent).toBe('2');
  });
});
