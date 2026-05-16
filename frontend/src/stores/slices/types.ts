import type { Elevation, Geometry, Project, Road, RoadObject, RoadObjectItem, RoadSignal, Junction, Lane, LaneLink, LaneWidth } from '../../services/platform';
import type { LaneSide, SceneNodeSelection } from '../../utils/sceneGraph';

// Re-export types used by the store's public API
export type { Elevation, Geometry, Project, Road, RoadObject, RoadObjectItem, RoadSignal, Junction, Lane, LaneLink, LaneWidth };
export type { LaneSide, SceneNodeSelection };

export interface EditorState {
  // Project state
  project: Project;
  /** Snapshot of the project at the last save/load — used for reset-to-saved. */
  savedProject: Project | null;
  isDirty: boolean;
  selectedRoadId: string | null;
  selectedJunctionId: string | null;
  selectedObjectType: 'road' | 'junction' | null;
  selectedSceneNode: SceneNodeSelection | null;

  // Multi-selection (rubber-band box select)
  selectedRoadIds: string[];
  selectedJunctionIds: string[];

  // Clipboard for copy-paste
  clipboardRoadId: string | null;

  // Cursor position (world coordinates)
  cursorWorldPos: { x: number; y: number };

  // Viewport scale info, updated by renderer on data load / camera change
  gridSpacing: number;
  viewportMpp: number;

  // Undo/Redo stacks
  undoStack: Project[];
  redoStack: Project[];

  projectLoadVersion: number;

  // Actions — project lifecycle
  setProject: (project: Project) => void;
  markDirty: () => void;
  markClean: () => void;
  reset: () => void;
  resetToSaved: () => void;
  setCursorWorldPos: (pos: { x: number; y: number }) => void;
  setViewportInfo: (info: { gridSpacing: number; mpp: number }) => void;

  // Actions — selection
  selectRoad: (id: string | null) => void;
  selectJunction: (id: string | null) => void;
  selectMultiple: (roadIds: string[], junctionIds: string[]) => void;
  selectLaneSection: (roadId: string, sectionIndex: number) => void;
  selectLane: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  selectSignal: (roadId: string, signalId: string) => void;
  selectObject: (roadId: string, objectId: string) => void;
  selectAll: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteFromClipboard: () => void;

  // Actions — undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  executePluginCommand: (
    description: string,
    executeFn: (project: Project) => Project,
  ) => void;

  // Actions — road operations
  addRoad: (road: Road) => void;
  removeRoad: (id: string) => void;
  updateRoad: (id: string, updates: Partial<Pick<Road, 'name' | 'length' | 'junction_id'>>) => void;
  updateRoadGeometry: (id: string, planView: Geometry[], length: number) => void;
  cloneRoad: (id: string, newId: string, offsetXy: [number, number]) => void;
  reverseRoad: (id: string) => void;
  mirrorRoad: (id: string) => void;
  optimizeRoad: (id: string) => void;
  swapCenterline: (id: string, targetLaneId: number) => void;
  moveRoad: (id: string, dx: number, dy: number) => void;
  rotateRoad: (id: string, angle: number, cx: number, cy: number) => void;
  removeJunction: (id: string) => void;
  updateJunction: (id: string, updates: Partial<Pick<Junction, 'name'>>) => void;
  addJunctionWithRoads: (junction: Junction, roads: Road[]) => void;

  // Actions — signals & objects
  addSignal: (signal: RoadSignal) => void;
  removeSignal: (id: string) => void;
  updateSignal: (id: string, updates: Partial<RoadSignal>) => void;
  addObject: (obj: RoadObject) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<RoadObject>) => void;
  /** Place a RoadObjectItem directly onto a road's objects[] array. */
  addRoadObjectItem: (roadId: string, obj: RoadObjectItem) => void;

  // Actions — lane operations
  updateLaneType: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, laneType: string) => void;
  updateLaneWidth: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, width: LaneWidth) => void;
  removeLane: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number) => void;
  addLane: (roadId: string, sectionIndex: number, side: 'left' | 'right') => void;
  addRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, mark: import('../../services/platform').RoadMark) => void;
  updateRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, markIndex: number, updates: Partial<import('../../services/platform').RoadMark>) => void;
  removeRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, markIndex: number) => void;
  updateLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, borderIndex: number, updates: Partial<import('../../services/platform').LaneBorder>) => void;
  addLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, border: import('../../services/platform').LaneBorder) => void;
  removeLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, borderIndex: number) => void;

  // Actions — elevation
  addElevationPoint: (roadId: string, s: number, height: number) => void;
  updateElevationPoint: (roadId: string, index: number, updates: Partial<Elevation>) => void;
  removeElevationPoint: (roadId: string, index: number) => void;
  smoothElevation: (roadId: string, iterations?: number) => void;
}

export const MAX_UNDO = 50;

export const initialProject: Project = {
  name: 'Untitled',
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
  roads: [],
  junctions: [],
  signals: [],
  objects: [],
};

/** Push current project onto undo stack, clear redo.
 *
 * Since Zustand state updates always produce new immutable objects via
 * spread operator, the current `state.project` reference is already a
 * safe snapshot — no deep clone needed. This avoids the O(n) cost of
 * `structuredClone` on every edit operation.
 */
export function pushUndo(state: EditorState): Partial<EditorState> {
  const undoStack = [...state.undoStack, state.project].slice(-MAX_UNDO);
  return { undoStack, redoStack: [] };
}

/** Zustand slice creator signature. */
export type SliceCreator<T> = (
  set: (fn: ((state: EditorState) => Partial<EditorState>) | Partial<EditorState>) => void,
  get: () => EditorState,
) => T;
