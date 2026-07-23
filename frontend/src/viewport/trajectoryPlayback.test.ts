import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => ({
  setDimension: vi.fn(),
  uploadActorVertices: vi.fn(),
  uploadPathVertices: vi.fn(),
  uploadEgoMeshIndexed: vi.fn(),
  clearEgoMesh: vi.fn(),
  render: vi.fn(),
  setChaseCam3D: vi.fn(),
  setChaseCameraActive: vi.fn(),
  frameScene3D: vi.fn(),
}));

vi.mock('./viewportRef', () => ({
  getViewportRenderer: () => renderer,
}));

const mockLoadEgoModelTemplate = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockBuildEgoMeshVertices = vi.hoisted(() => vi.fn(() => new Float32Array(0)));
vi.mock('./egoModel', () => ({
  loadEgoModelTemplate: mockLoadEgoModelTemplate,
  buildEgoMeshVertices: mockBuildEgoMeshVertices,
}));

const mockShowAlert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../utils/dialog', () => ({
  showAlert: mockShowAlert,
}));

vi.mock('../i18n', () => ({
  default: { t: (key: string, fallback?: string) => fallback ?? key },
}));

import { parseTraj } from '../plugins/npc-actors';
import { useTrajectoryStore } from '../stores/trajectoryStore';
import {
  startTrajectory,
  stopTrajectory,
  promptImportTrajectory,
} from './trajectoryPlayback';

const DATA = parseTraj([
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,1,4.5,2,1.6,0,Y',
  'ego,1,10,0,3,4.5,2,1.6,20,Y',
].join('\n'));

describe('trajectory follow playback', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('updates the follow camera before actor upload without a synchronous extra render', () => {
    startTrajectory(DATA);
    useTrajectoryStore.getState().toggleFollowEgo();
    expect(renderer.setChaseCameraActive).toHaveBeenLastCalledWith(true);
    vi.clearAllMocks();

    useTrajectoryStore.getState().seek(0.5);

    expect(renderer.setChaseCam3D).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setChaseCam3D.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.uploadActorVertices.mock.invocationCallOrder[0]!,
    );
    expect(renderer.setChaseCam3D.mock.calls[0]![2]).toBeGreaterThan(1);

    const vertices = renderer.uploadActorVertices.mock.calls[0]![0] as Float32Array;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < vertices.length; i += 7) {
      minX = Math.min(minX, vertices[i]!);
      maxX = Math.max(maxX, vertices[i]!);
    }
    expect((minX + maxX) / 2).toBeCloseTo(
      renderer.setChaseCam3D.mock.calls[0]![0],
      5,
    );

    useTrajectoryStore.getState().toggleFollowEgo();
    expect(renderer.setChaseCameraActive).toHaveBeenLastCalledWith(false);
  });
});

describe('trajectory playback frame-rate cap', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throttles playhead updates to the capped rate while keeping the rAF clock alive', () => {
    let captured: FrameRequestCallback | null = null;
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      captured = cb;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    // play() (inside startTrajectory) resets the playhead to tMin and records
    // lastPerf = 1000, scheduling the first tick which we capture here.
    startTrajectory(DATA);
    expect(useTrajectoryStore.getState().isPlaying).toBe(true);
    expect(useTrajectoryStore.getState().currentTime).toBe(0);
    expect(captured).toBeTypeOf('function');

    // A frame inside the cap interval (< 1000/30 ≈ 33.3 ms) must NOT advance the
    // playhead, but must keep the rAF clock scheduled.
    rafSpy.mockClear();
    nowMs = 1016;
    captured!(1016);
    expect(useTrajectoryStore.getState().currentTime).toBe(0);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Once the interval elapses, the playhead advances by the full elapsed dt.
    nowMs = 1040;
    captured!(1040);
    expect(useTrajectoryStore.getState().currentTime).toBeGreaterThan(0);
  });
});

const MULTI_FRAME_DATA = parseTraj([
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,1,4.5,2,1.6,0,Y',
  'ego,0.5,5,0,2,4.5,2,1.6,10,Y',
  'ego,1,10,0,3,4.5,2,1.6,20,Y',
  'npc1,0,20,5,1,4,1.8,1.5,90,N',
  'npc1,0.5,20,10,1,4,1.8,1.5,90,N',
  'npc1,1,20,15,1,4,1.8,1.5,90,N',
].join('\n'));

describe('trajectory tick loop behavior', () => {
  let captured: FrameRequestCallback | null = null;
  let nowMs = 1000;

  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    captured = null;
    nowMs = 1000;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      captured = cb;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loops playhead back to tMin when loop is enabled and playhead exceeds tMax', () => {
    startTrajectory(MULTI_FRAME_DATA);
    // Ensure loop is on (default)
    expect(useTrajectoryStore.getState().loop).toBe(true);
    expect(useTrajectoryStore.getState().isPlaying).toBe(true);

    // Advance far past tMax (1s) in a single frame
    nowMs = 2200;
    captured!(2200);
    const t = useTrajectoryStore.getState().currentTime;
    // Should have wrapped around — should be < tMax
    expect(t).toBeLessThan(1);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(useTrajectoryStore.getState().isPlaying).toBe(true);
  });

  it('stops at tMax when loop is disabled', () => {
    startTrajectory(MULTI_FRAME_DATA);
    useTrajectoryStore.getState().toggleLoop();
    expect(useTrajectoryStore.getState().loop).toBe(false);

    // Seek close to end, then tick with enough dt to exceed tMax.
    // dt is capped at 0.1s per tick, speed=1, so we need currentTime + 0.1 >= 1.
    useTrajectoryStore.getState().seek(0.95);
    // Advance by 100ms (dt=0.1 after cap) from lastPerf=1000
    nowMs = 1100;
    captured!(1100);
    expect(useTrajectoryStore.getState().currentTime).toBe(1);
    expect(useTrajectoryStore.getState().isPlaying).toBe(false);
  });

  it('tick exits early if not playing', () => {
    startTrajectory(MULTI_FRAME_DATA);
    useTrajectoryStore.getState().pause();

    nowMs = 1100;
    const rafSpy = vi.mocked(requestAnimationFrame);
    rafSpy.mockClear();
    // Call the captured tick while paused
    captured!(1100);
    // Should not schedule another frame
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

describe('trajectory subscription - data changes', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('clears renderer when data is set to null', () => {
    startTrajectory(MULTI_FRAME_DATA);
    vi.clearAllMocks();

    useTrajectoryStore.getState().clear();

    expect(renderer.uploadActorVertices).toHaveBeenCalledWith(expect.any(Float32Array));
    expect(renderer.uploadPathVertices).toHaveBeenCalledWith(expect.any(Float32Array));
    expect(renderer.clearEgoMesh).toHaveBeenCalled();
    // Verify the buffers are empty
    const actorBuf = renderer.uploadActorVertices.mock.calls[0]![0] as Float32Array;
    expect(actorBuf.length).toBe(0);
  });

  it('uploads path vertices on data load', () => {
    startTrajectory(MULTI_FRAME_DATA);
    // The subscription should have uploaded path vertices (empty ribbons)
    expect(renderer.uploadPathVertices).toHaveBeenCalled();
  });

  it('renders actors when time changes', () => {
    startTrajectory(MULTI_FRAME_DATA);
    vi.clearAllMocks();

    useTrajectoryStore.getState().seek(0.5);
    expect(renderer.uploadActorVertices).toHaveBeenCalled();
  });
});

describe('trajectory follow - heading derivation', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives heading from travel direction after initial snap', () => {
    startTrajectory(MULTI_FRAME_DATA);
    useTrajectoryStore.getState().toggleFollowEgo();
    vi.clearAllMocks();

    // First seek after follow enabled (snap)
    useTrajectoryStore.getState().seek(0.2);
    expect(renderer.setChaseCam3D).toHaveBeenCalled();

    vi.clearAllMocks();
    // Second seek — should derive heading from travel direction
    useTrajectoryStore.getState().seek(0.8);
    expect(renderer.setChaseCam3D).toHaveBeenCalled();
  });

  it('snaps on large time jumps (seek backward)', () => {
    startTrajectory(MULTI_FRAME_DATA);
    useTrajectoryStore.getState().toggleFollowEgo();

    // Seek forward
    useTrajectoryStore.getState().seek(0.8);
    vi.clearAllMocks();

    // Seek backward — large jump should snap
    useTrajectoryStore.getState().seek(0.1);
    expect(renderer.setChaseCam3D).toHaveBeenCalled();
  });

  it('disables chase camera when follow is toggled off', () => {
    startTrajectory(MULTI_FRAME_DATA);
    useTrajectoryStore.getState().toggleFollowEgo();
    vi.clearAllMocks();

    useTrajectoryStore.getState().toggleFollowEgo();
    expect(renderer.setChaseCameraActive).toHaveBeenLastCalledWith(false);
  });
});

describe('startTrajectory edge cases', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('does nothing for empty entities', () => {
    const empty = parseTraj('ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego\n');
    startTrajectory(empty);
    expect(renderer.setDimension).not.toHaveBeenCalled();
  });

  it('applies scene origin offset to framing', () => {
    const origin: [number, number, number] = [100, 200, 0];
    startTrajectory(MULTI_FRAME_DATA, origin);
    expect(renderer.frameScene3D).toHaveBeenCalled();
    // The frame call should subtract the origin
    const args = renderer.frameScene3D.mock.calls[0]!;
    expect(args[0]).toBeLessThan(0); // bounds.minX - 100 should be negative
  });

  it('renders ego model when template loads', async () => {
    const fakeTemplate = {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 1, 0]),
      indices: new Uint16Array([0]),
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    };
    mockLoadEgoModelTemplate.mockResolvedValueOnce(fakeTemplate);
    mockBuildEgoMeshVertices.mockReturnValue(new Float32Array([0, 0, 0, 0, 1, 0, 1]));

    startTrajectory(MULTI_FRAME_DATA);
    // Wait for the ego model load promise
    await vi.waitFor(() => {
      expect(renderer.uploadEgoMeshIndexed).toHaveBeenCalled();
    });
  });
});

describe('promptImportTrajectory', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    mockLoadEgoModelTemplate.mockResolvedValue(null);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mockShowAlert.mockClear();
  });

  it('shows error for oversized files', () => {
    const createElementOrig = document.createElement.bind(document);
    const mockInput = createElementOrig('input');
    vi.spyOn(document, 'createElement').mockReturnValue(mockInput as any);
    vi.spyOn(mockInput, 'click').mockImplementation(() => {
      // Simulate choosing a file that is too large
      const bigFile = new File(['x'], 'big.traj', { type: 'text/plain' });
      Object.defineProperty(bigFile, 'size', { value: 200 * 1024 * 1024 });
      Object.defineProperty(mockInput, 'files', { value: [bigFile], configurable: true });
      mockInput.onchange?.(new Event('change'));
    });

    promptImportTrajectory();
    expect(mockShowAlert).toHaveBeenCalledWith(
      expect.stringContaining('dialog.importError'),
      expect.any(String),
    );
  });

  it('shows warning for empty trajectory data', async () => {
    const createElementOrig = document.createElement.bind(document);
    const mockInput = createElementOrig('input');
    vi.spyOn(document, 'createElement').mockReturnValue(mockInput as any);
    vi.spyOn(mockInput, 'click').mockImplementation(() => {
      const emptyFile = new File(
        ['ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego\n'],
        'empty.traj',
        { type: 'text/plain' },
      );
      Object.defineProperty(mockInput, 'files', { value: [emptyFile], configurable: true });
      mockInput.onchange?.(new Event('change'));
    });

    promptImportTrajectory();
    // FileReader is async
    await vi.waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('dialog.importEmptyProject'),
        expect.any(String),
      );
    });
  });

  it('shows error with details on parse failure', async () => {
    const createElementOrig = document.createElement.bind(document);
    const mockInput = createElementOrig('input');
    vi.spyOn(document, 'createElement').mockReturnValue(mockInput as any);
    vi.spyOn(mockInput, 'click').mockImplementation(() => {
      // Malformed content that will throw during parseTraj
      const badFile = new File(
        ['not,a,valid,header\n1,2,3,4'],
        'bad.traj',
        { type: 'text/plain' },
      );
      Object.defineProperty(mockInput, 'files', { value: [badFile], configurable: true });
      mockInput.onchange?.(new Event('change'));
    });

    promptImportTrajectory();
    await vi.waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalled();
    });
  });

  it('does nothing if no file is selected', () => {
    const createElementOrig = document.createElement.bind(document);
    const mockInput = createElementOrig('input');
    vi.spyOn(document, 'createElement').mockReturnValue(mockInput as any);
    vi.spyOn(mockInput, 'click').mockImplementation(() => {
      Object.defineProperty(mockInput, 'files', { value: [], configurable: true });
      mockInput.onchange?.(new Event('change'));
    });

    promptImportTrajectory();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });
});
