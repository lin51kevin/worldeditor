import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewportKeyboard } from './useViewportKeyboard';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import type { Road } from '../services/platform';

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r1',
    name: 'Road 1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    lane_sections: [],
    elevation_profile: [],
    ...overrides,
  };
}

function keydown(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useViewportKeyboard', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useViewportStore.setState({ editMode: 'default', selectionMode: 'road' });
    renderHook(() => useViewportKeyboard());
  });

  afterEach(() => {
    // renderHook cleanup removes the keydown listener between tests.
  });

  it('deselects the current road on Escape', () => {
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    keydown('Escape');
    expect(useProjectStore.getState().selectedRoadId).toBeNull();
  });

  it('deletes the selected road on Delete in default mode', () => {
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    keydown('Delete');
    expect(useProjectStore.getState().project.roads).toHaveLength(0);
  });

  it('switches to lane-section selection mode on key "2" with a road selected', () => {
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    keydown('2');
    expect(useViewportStore.getState().selectionMode).toBe('laneSection');
  });

  it('does not delete when nothing is selected', () => {
    useProjectStore.getState().addRoad(makeRoad());
    keydown('Delete');
    expect(useProjectStore.getState().project.roads).toHaveLength(1);
  });
});
