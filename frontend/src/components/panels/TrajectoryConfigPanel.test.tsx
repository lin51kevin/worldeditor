import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrajectoryConfigPanel } from './TrajectoryConfigPanel';
import { useTrajectoryStore } from '../../stores/trajectoryStore';
import { useTrajectoryConfigStore } from '../../stores/trajectoryConfigStore';
import { parseTraj } from '../../plugins/npc-actors';

// Keep the component test free of the renderer / platform chains.
vi.mock('../../viewport/trajectoryPlayback', () => ({
  refreshActorModels: vi.fn().mockResolvedValue(undefined),
  applySceneModel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../viewport/trajectorySceneScan', () => ({
  scanAndClassify: vi.fn(),
  classifyWebFiles: vi.fn(),
}));
vi.mock('../../services', () => ({
  getPlatformService: vi.fn(),
}));
vi.mock('../layout/FloatingPanel', () => ({
  FloatingPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,0,4.5,2,1.6,0,Y',
  'npc_1,0,5,5,0,4,2,1.6,0,N',
  'npc_2,0,8,8,0,4,2,1.6,0,N',
].join('\n');

function loadTrajectory(): void {
  act(() => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
  });
}

afterEach(() => {
  act(() => {
    useTrajectoryStore.getState().clear();
    useTrajectoryConfigStore.getState().reset();
  });
  localStorage.clear();
});

describe('TrajectoryConfigPanel', () => {
  it('renders nothing when the panel is closed', () => {
    loadTrajectory();
    const { container } = render(<TrajectoryConfigPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the ego row with the ego actor id when open', () => {
    loadTrajectory();
    act(() => useTrajectoryConfigStore.getState().toggleConfigOpen(true));
    render(<TrajectoryConfigPanel />);
    expect(screen.getByText('轨迹场景配置')).toBeTruthy();
    expect(screen.getByText('ego')).toBeTruthy();
  });

  it('adds an opponent mapping from the two dropdowns', () => {
    loadTrajectory();
    act(() => {
      useTrajectoryConfigStore.getState().toggleConfigOpen(true);
      useTrajectoryConfigStore.getState().setScan({
        npcs: [{ key: '/cars/suv.ply', name: 'suv.ply' }],
        scenes: [],
        roads: [],
        trajectories: [],
      });
    });
    render(<TrajectoryConfigPanel />);

    fireEvent.change(screen.getByLabelText('选择对手元素'), { target: { value: 'npc_1' } });
    // The PLY picker is a custom thumbnail dropdown: open it, then choose the item.
    fireEvent.click(screen.getByLabelText('选择 PLY'));
    fireEvent.click(screen.getByText('suv.ply'));
    fireEvent.click(screen.getByLabelText('添加映射'));

    expect(useTrajectoryConfigStore.getState().actorModels.npc_1).toBe('/cars/suv.ply');
  });

  it('removes a configured opponent mapping', () => {
    loadTrajectory();
    act(() => {
      useTrajectoryConfigStore.getState().toggleConfigOpen(true);
      useTrajectoryConfigStore.getState().setScan({
        npcs: [{ key: 'k', name: 'k.ply' }],
        scenes: [],
        roads: [],
        trajectories: [],
      });
      useTrajectoryConfigStore.getState().setActorModel('npc_1', 'k');
    });
    render(<TrajectoryConfigPanel />);

    fireEvent.click(screen.getByLabelText('删除 npc_1 的映射'));
    expect('npc_1' in useTrajectoryConfigStore.getState().actorModels).toBe(false);
  });
});
