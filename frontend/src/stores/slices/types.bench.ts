/**
 * Performance benchmarks for undo/redo state operations.
 *
 * Run with: yarn vitest bench
 * Or via justfile: just bench
 *
 * These benchmarks establish performance baselines so that accidental
 * regressions (e.g. reintroducing structuredClone in pushUndo) are caught.
 */

import { bench, describe, expect } from 'vitest';
import { pushUndo, MAX_UNDO } from './types';
import type { EditorState } from './types';
import type { Project } from '../../services/platform';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRoad(id: string) {
  return {
    id,
    name: `Road ${id}`,
    length: 100.0,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' as const }],
    elevation_profile: [],
    lane_sections: [
      {
        s: 0,
        single_side: false,
        render_hidden: false,
        left: [],
        center: [],
        right: [],
      },
    ],
  };
}

function makeProject(roadCount: number): Project {
  return {
    name: `Test Project (${roadCount} roads)`,
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: Array.from({ length: roadCount }, (_, i) => makeRoad(String(i))),
    junctions: [],
    signals: [],
    objects: [],
  } as Project;
}

function makeState(roadCount: number): EditorState {
  const project = makeProject(roadCount);
  return {
    project,
    savedProject: null,
    isDirty: false,
    selectedRoadId: null,
    selectedJunctionId: null,
    selectedObjectType: null,
    selectedSceneNode: null,
    selectedRoadIds: [],
    selectedJunctionIds: [],
    clipboardRoadId: null,
    cursorWorldPos: { x: 0, y: 0 },
    gridSpacing: 10,
    viewportMpp: 1,
    undoStack: [],
    redoStack: [],
    projectLoadVersion: 0,
    // action stubs — not called in bench
    setProject: () => {},
    markDirty: () => {},
    markClean: () => {},
    reset: () => {},
    resetToSaved: () => {},
    setCursorWorldPos: () => {},
    setViewportInfo: () => {},
    selectRoad: () => {},
    selectJunction: () => {},
    selectMultiple: () => {},
    selectLaneSection: () => {},
    selectLane: () => {},
    selectSignal: () => {},
    selectAll: () => {},
    deleteSelected: () => {},
    duplicateSelected: () => {},
    copySelected: () => {},
    pasteFromClipboard: () => {},
    undo: () => {},
    redo: () => {},
    canUndo: () => false,
    canRedo: () => false,
    executePluginCommand: () => {},
    addRoad: () => {},
    removeRoad: () => {},
    updateRoad: () => {},
    updateRoadGeometry: () => {},
    cloneRoad: () => {},
    reverseRoad: () => {},
    mirrorRoad: () => {},
    optimizeRoad: () => {},
    swapCenterline: () => {},
    moveRoad: () => {},
    rotateRoad: () => {},
    removeJunction: () => {},
    updateJunction: () => {},
    addJunctionWithRoads: () => {},
    addSignal: () => {},
    removeSignal: () => {},
    updateSignal: () => {},
    addObject: () => {},
    removeObject: () => {},
    updateObject: () => {},
    updateLaneType: () => {},
    updateLaneWidth: () => {},
    removeLane: () => {},
    addLane: () => {},
    addRoadMark: () => {},
    updateRoadMark: () => {},
    removeRoadMark: () => {},
    updateLaneBorder: () => {},
    addLaneBorder: () => {},
    removeLaneBorder: () => {},
    addElevationPoint: () => {},
    updateElevationPoint: () => {},
    removeElevationPoint: () => {},
    smoothElevation: () => {},
  } as unknown as EditorState;
}

// ── Correctness guard — pushUndo must NOT deep-clone ─────────────────────────

describe('pushUndo correctness', () => {
  bench('pushUndo preserves project reference (no deep clone)', () => {
    const state = makeState(100);
    const result = pushUndo(state);
    // The stacked entry must be the same reference, not a clone.
    expect(result.undoStack![result.undoStack!.length - 1]).toBe(state.project);
  });

  bench('pushUndo trims stack to MAX_UNDO', () => {
    const state = makeState(10);
    state.undoStack = Array.from({ length: MAX_UNDO + 5 }, () => state.project);
    const result = pushUndo(state);
    expect(result.undoStack!.length).toBeLessThanOrEqual(MAX_UNDO);
  });
});

// ── Performance benchmarks ───────────────────────────────────────────────────

describe('pushUndo performance', () => {
  bench('small project (10 roads) — 1000 undo pushes', () => {
    const state = makeState(10);
    for (let i = 0; i < 1000; i++) {
      pushUndo(state);
    }
  });

  bench('medium project (100 roads) — 1000 undo pushes', () => {
    const state = makeState(100);
    for (let i = 0; i < 1000; i++) {
      pushUndo(state);
    }
  });

  bench('large project (1000 roads) — 1000 undo pushes', () => {
    const state = makeState(1000);
    for (let i = 0; i < 1000; i++) {
      pushUndo(state);
    }
  });
});
