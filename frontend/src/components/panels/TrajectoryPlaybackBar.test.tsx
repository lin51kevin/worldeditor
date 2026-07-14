import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrajectoryPlaybackBar } from './TrajectoryPlaybackBar';
import { useTrajectoryStore } from '../../stores/trajectoryStore';
import { parseTraj } from '../../plugins/npc-actors';

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,0,4.5,2,1.6,0,Y',
  'ego,2,10,0,0,4.5,2,1.6,0,Y',
].join('\n');

function load(): void {
  useTrajectoryStore.getState().loadData(parseTraj(CSV));
}

afterEach(() => {
  act(() => {
    useTrajectoryStore.getState().clear();
    useTrajectoryStore.setState({ loop: true, speed: 1 });
  });
});

describe('TrajectoryPlaybackBar', () => {
  it('renders nothing when no trajectory is loaded', () => {
    const { container } = render(<TrajectoryPlaybackBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the control strip once a trajectory is loaded', () => {
    load();
    render(<TrajectoryPlaybackBar />);
    expect(screen.getByRole('slider')).toBeTruthy();
    // Time readout starts at 00:00.0 / 00:02.0.
    expect(screen.getByText('00:00.0 / 00:02.0')).toBeTruthy();
  });

  it('exposes an import button that opens a trajectory file dialog', () => {
    load();
    const clicked: HTMLInputElement[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'input') {
        (el as HTMLInputElement).click = () => { clicked.push(el as HTMLInputElement); };
      }
      return el;
    });
    render(<TrajectoryPlaybackBar />);
    fireEvent.click(screen.getByLabelText('导入轨迹文件...'));
    expect(clicked.length).toBe(1);
    expect(clicked[0]!.accept).toContain('.traj');
    spy.mockRestore();
  });

  it('toggles playback when the play button is clicked', () => {
    load();
    render(<TrajectoryPlaybackBar />);
    expect(useTrajectoryStore.getState().isPlaying).toBe(false);
    act(() => { fireEvent.click(screen.getByLabelText('播放')); });
    expect(useTrajectoryStore.getState().isPlaying).toBe(true);
  });

  it('seeks when the scrubber is dragged', () => {
    load();
    render(<TrajectoryPlaybackBar />);
    act(() => { fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } }); });
    expect(useTrajectoryStore.getState().currentTime).toBe(1);
  });

  it('changes speed via the dropdown', () => {
    load();
    render(<TrajectoryPlaybackBar />);
    act(() => { fireEvent.change(screen.getByLabelText('播放倍速'), { target: { value: '2' } }); });
    expect(useTrajectoryStore.getState().speed).toBe(2);
  });

  it('clears the trajectory when the close button is clicked', () => {
    load();
    render(<TrajectoryPlaybackBar />);
    act(() => { fireEvent.click(screen.getByLabelText('关闭轨迹')); });
    expect(useTrajectoryStore.getState().data).toBeNull();
  });
});
