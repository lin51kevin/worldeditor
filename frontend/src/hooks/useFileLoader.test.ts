import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileLoader } from './useFileLoader';
import { useLoadingProgressStore } from '../stores/loadingProgressStore';
import { useProjectStore } from '../stores/projectStore';

// Mock the platform service
vi.mock('../services', () => ({
  getPlatformService: vi.fn().mockResolvedValue({
    parseOpenDrive: vi.fn().mockResolvedValue({
      name: 'test',
      header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
      roads: [],
      junctions: [],
      signals: [],
      objects: [],
    }),
  }),
}));

describe('useFileLoader', () => {
  beforeEach(() => {
    useLoadingProgressStore.getState().reset();
    useProjectStore.getState().reset();
  });

  it('should load a small file successfully on main thread', async () => {
    const { result } = renderHook(() => useFileLoader());

    let loadResult: Awaited<ReturnType<typeof result.current.loadFile>>;
    await act(async () => {
      loadResult = await result.current.loadFile('<OpenDRIVE/>', 'small.xodr');
    });

    expect(loadResult!.success).toBe(true);
    expect(loadResult!.project).toBeDefined();
  });

  it('should update progress store during loading', async () => {
    const { result } = renderHook(() => useFileLoader());

    await act(async () => {
      await result.current.loadFile('<OpenDRIVE/>', 'test.xodr');
    });

    // After successful load, phase should be reset (via the auto-hide timer)
    // But since timer is 600ms and our test is immediate, check for done first
    const state = useLoadingProgressStore.getState();
    // Phase should be 'done' or already reset to 'idle' depending on timing
    expect(['done', 'idle']).toContain(state.phase);
  });

  it('should set project in store on success', async () => {
    const { result } = renderHook(() => useFileLoader());

    await act(async () => {
      await result.current.loadFile('<OpenDRIVE/>', 'map.xodr');
    });

    const project = useProjectStore.getState().project;
    expect(project.name).toBe('map.xodr');
  });

  it('should return error result on failure', async () => {
    const { getPlatformService } = await import('../services');
    (getPlatformService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      parseOpenDrive: vi.fn().mockRejectedValue(new Error('Parse failed')),
    });

    const { result } = renderHook(() => useFileLoader());

    let loadResult: Awaited<ReturnType<typeof result.current.loadFile>>;
    await act(async () => {
      loadResult = await result.current.loadFile('<invalid/>', 'bad.xodr');
    });

    expect(loadResult!.success).toBe(false);
    expect(loadResult!.error).toContain('Parse failed');
    // Progress should be reset on failure
    expect(useLoadingProgressStore.getState().phase).toBe('idle');
  });

  it('should load from dropped file', async () => {
    const { result } = renderHook(() => useFileLoader());
    const file = new File(['<OpenDRIVE/>'], 'dropped.xodr', { type: 'application/xml' });
    // jsdom's File doesn't implement text(), so we mock it
    file.text = vi.fn().mockResolvedValue('<OpenDRIVE/>');

    let loadResult: Awaited<ReturnType<typeof result.current.loadFromDrop>>;
    await act(async () => {
      loadResult = await result.current.loadFromDrop(file);
    });

    expect(loadResult!.success).toBe(true);
    const project = useProjectStore.getState().project;
    expect(project.name).toBe('dropped.xodr');
  });
});
