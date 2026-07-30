import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRenderStats = vi.fn();
vi.mock('../../../viewport/viewportRef', () => ({
  getViewportRenderer: () => ({ getRenderStats: mockGetRenderStats }),
}));

import { TrajectoryStatsHud } from './TrajectoryStatsHud';
import { useTrajectoryStore } from '../../../stores/trajectoryStore';
import { useTrajectoryConfigStore } from '../../../stores/trajectoryConfigStore';
import { parseTraj } from '../../npc-actors';

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,0,4.5,2,1.6,0,Y',
  'ego,2,10,0,0,4.5,2,1.6,0,Y',
  'npc1,0,5,5,0,4.5,2,1.6,0,N',
  'npc1,2,15,5,0,4.5,2,1.6,0,N',
].join('\n');

function load(): void {
  act(() => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
  });
}

beforeEach(() => {
  mockGetRenderStats.mockReset();
});

afterEach(() => {
  act(() => {
    useTrajectoryStore.getState().clear();
    useTrajectoryConfigStore.getState().toggleStatsHud(false);
  });
});

describe('TrajectoryStatsHud', () => {
  it('renders nothing when no trajectory is loaded', () => {
    act(() => useTrajectoryConfigStore.getState().toggleStatsHud(true));
    const { container } = render(<TrajectoryStatsHud />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing while the HUD toggle is off', () => {
    load();
    const { container } = render(<TrajectoryStatsHud />);
    expect(container.firstChild).toBeNull();
  });

  it('shows live fps, frame time, actor and splat counts when active', async () => {
    load();
    act(() => useTrajectoryConfigStore.getState().toggleStatsHud(true));
    mockGetRenderStats.mockReturnValue({
      fps: 59.6,
      frameTimeMs: 16.4,
      splatCount: 12345,
      lastRenderTs: performance.now(),
    });
    render(<TrajectoryStatsHud />);
    await waitFor(() => expect(screen.getByText('60')).toBeInTheDocument());
    expect(screen.getByText('16.4 ms')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // ego + npc1
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('reports idle when the render loop has parked (stale last frame)', async () => {
    load();
    act(() => useTrajectoryConfigStore.getState().toggleStatsHud(true));
    mockGetRenderStats.mockReturnValue({
      fps: 60,
      frameTimeMs: 16.6,
      splatCount: 0,
      lastRenderTs: performance.now() - 5000, // stale → idle
    });
    render(<TrajectoryStatsHud />);
    await waitFor(() => expect(screen.getByText('待机')).toBeInTheDocument());
    expect(screen.getByText('— ms')).toBeInTheDocument();
  });
});
