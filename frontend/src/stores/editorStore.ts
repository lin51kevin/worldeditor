import { create } from 'zustand';
import type { Elevation, Geometry, Project, Road, RoadObject, Signal, Junction, LaneWidth } from '../services/platform';
import type { LaneSide, SceneNodeSelection } from '../utils/sceneGraph';

interface EditorState {
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
  gridSpacing: number;   // world units per grid cell (auto-derived from data extent)
  viewportMpp: number;   // meters per screen pixel (camera-dependent)

  // Undo/Redo stacks
  undoStack: Project[];
  redoStack: Project[];

  // Actions
  setProject: (project: Project) => void;
  selectRoad: (id: string | null) => void;
  selectJunction: (id: string | null) => void;
  selectMultiple: (roadIds: string[], junctionIds: string[]) => void;
  selectLaneSection: (roadId: string, sectionIndex: number) => void;
  selectLane: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  addRoad: (road: Road) => void;
  removeRoad: (id: string) => void;
  removeJunction: (id: string) => void;
  deleteSelected: () => void;
  selectAll: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteFromClipboard: () => void;
  updateRoad: (id: string, updates: Partial<Pick<Road, 'name' | 'length' | 'junction_id'>>) => void;
  updateRoadGeometry: (id: string, planView: Geometry[], length: number) => void;
  cloneRoad: (id: string, newId: string, offsetXy: [number, number]) => void;
  reverseRoad: (id: string) => void;
  mirrorRoad: (id: string) => void;
  optimizeRoad: (id: string) => void;
  swapCenterline: (id: string, targetLaneId: number) => void;
  /** Translate a road's plan_view by (dx, dy). */
  moveRoad: (id: string, dx: number, dy: number) => void;
  /** Rotate a road's plan_view by `angle` radians around the point (cx, cy). */
  rotateRoad: (id: string, angle: number, cx: number, cy: number) => void;
  updateJunction: (id: string, updates: Partial<Pick<Junction, 'name'>>) => void;
  /** Add multiple roads and a junction record in a single undoable operation */
  addJunctionWithRoads: (junction: Junction, roads: Road[]) => void;
  addSignal: (signal: Signal) => void;
  removeSignal: (id: string) => void;
  updateSignal: (id: string, updates: Partial<Signal>) => void;
  addObject: (obj: RoadObject) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<RoadObject>) => void;
  updateLaneType: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, laneType: string) => void;
  updateLaneWidth: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, width: LaneWidth) => void;
  removeLane: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number) => void;
  addElevationPoint: (roadId: string, s: number, height: number) => void;
  updateElevationPoint: (roadId: string, index: number, updates: Partial<Elevation>) => void;
  removeElevationPoint: (roadId: string, index: number) => void;
  smoothElevation: (roadId: string, iterations?: number) => void;
  projectLoadVersion: number;
  setCursorWorldPos: (pos: { x: number; y: number }) => void;
  setViewportInfo: (info: { gridSpacing: number; mpp: number }) => void;
  markDirty: () => void;
  markClean: () => void;
  reset: () => void;
  resetToSaved: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /**
   * Execute a plugin-contributed command with undo support.
   * The executeFn receives the current project and returns the modified project.
   * The previous project is pushed onto the undo stack automatically.
   */
  executePluginCommand: (
    description: string,
    executeFn: (project: Project) => Project,
  ) => void;
}

// Signal and Object types for store
export type { Signal, RoadObject };

const MAX_UNDO = 50;

const initialProject: Project = {
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
};

/** Push current project onto undo stack, clear redo. */
function pushUndo(state: EditorState): Partial<EditorState> {
  const undoStack = [...state.undoStack, structuredClone(state.project)].slice(-MAX_UNDO);
  return { undoStack, redoStack: [] };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: initialProject,
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
  gridSpacing: 10.0,
  viewportMpp: 0.1,
  projectLoadVersion: 0,
  undoStack: [],
  redoStack: [],

  setProject: (project) => set((s) => ({ project, savedProject: project, isDirty: false, undoStack: [], redoStack: [], projectLoadVersion: s.projectLoadVersion + 1 })),

  selectRoad: (id) =>
    set({
      selectedRoadId: id,
      selectedJunctionId: null,
      selectedObjectType: id ? 'road' : null,
      selectedSceneNode: id ? { type: 'road', roadId: id } : null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
    }),

  selectJunction: (id) =>
    set({
      selectedJunctionId: id,
      selectedRoadId: null,
      selectedObjectType: id ? 'junction' : null,
      selectedSceneNode: id ? { type: 'junction', junctionId: id } : null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
    }),

  selectMultiple: (roadIds, junctionIds) =>
    set({
      selectedRoadIds: roadIds,
      selectedJunctionIds: junctionIds,
      selectedRoadId: null,
      selectedJunctionId: null,
      selectedObjectType: null,
      selectedSceneNode: null,
    }),

  selectLaneSection: (roadId, sectionIndex) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'laneSection', roadId, sectionIndex },
    }),

  selectLane: (roadId, sectionIndex, side, laneId) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'lane', roadId, sectionIndex, side, laneId },
    }),

  addRoad: (road) =>
    set((state) => ({
      ...pushUndo(state),
      project: { ...state.project, roads: [...state.project.roads, road] },
      isDirty: true,
    })),

  removeRoad: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.filter((r) => r.id !== id),
      },
      isDirty: true,
      selectedRoadId: state.selectedRoadId === id ? null : state.selectedRoadId,
      selectedSceneNode: state.selectedSceneNode && 'roadId' in state.selectedSceneNode && state.selectedSceneNode.roadId === id
        ? null
        : state.selectedSceneNode,
    })),

  removeJunction: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        junctions: state.project.junctions.filter((j) => j.id !== id),
      },
      isDirty: true,
      selectedJunctionId: state.selectedJunctionId === id ? null : state.selectedJunctionId,
      selectedObjectType: state.selectedJunctionId === id ? null : state.selectedObjectType,
      selectedSceneNode: state.selectedSceneNode && 'junctionId' in state.selectedSceneNode && state.selectedSceneNode.junctionId === id
        ? null
        : state.selectedSceneNode,
    })),

  deleteSelected: () => {
    const state = get();
    // Multi-select takes priority
    if (state.selectedRoadIds.length > 0 || state.selectedJunctionIds.length > 0) {
      const { selectedRoadIds, selectedJunctionIds } = state;
      set((s) => ({
        ...pushUndo(s),
        project: {
          ...s.project,
          roads: s.project.roads.filter((r) => !selectedRoadIds.includes(r.id)),
          junctions: s.project.junctions.filter((j) => !selectedJunctionIds.includes(j.id)),
        },
        isDirty: true,
        selectedRoadIds: [],
        selectedJunctionIds: [],
      }));
      return;
    }
    if (state.selectedRoadId) {
      get().removeRoad(state.selectedRoadId);
      return;
    }
    if (state.selectedJunctionId) {
      get().removeJunction(state.selectedJunctionId);
    }
  },

  selectAll: () => {
    const { project } = get();
    const roadIds = project.roads.map((r) => r.id);
    const junctionIds = project.junctions.map((j) => j.id);
    get().selectMultiple(roadIds, junctionIds);
  },

  duplicateSelected: () => {
    const { selectedRoadId, project } = get();
    if (!selectedRoadId) return;
    const existing = new Set(project.roads.map((r) => r.id));
    let i = 1;
    let newId = `${selectedRoadId}_copy${i}`;
    while (existing.has(newId)) {
      i += 1;
      newId = `${selectedRoadId}_copy${i}`;
    }
    get().cloneRoad(selectedRoadId, newId, [5, 5]);
    get().selectRoad(newId);
  },

  copySelected: () => {
    const { selectedRoadId } = get();
    if (!selectedRoadId) return;
    set({ clipboardRoadId: selectedRoadId });
  },

  pasteFromClipboard: () => {
    const { clipboardRoadId, project } = get();
    if (!clipboardRoadId) return;
    const existing = new Set(project.roads.map((r) => r.id));
    let i = 1;
    let newId = `${clipboardRoadId}_copy${i}`;
    while (existing.has(newId)) {
      i += 1;
      newId = `${clipboardRoadId}_copy${i}`;
    }
    get().cloneRoad(clipboardRoadId, newId, [5, 5]);
    get().selectRoad(newId);
  },

  updateRoad: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === id ? { ...r, ...updates } : r,
        ),
      },
      isDirty: true,
    })),

  updateRoadGeometry: (id, planView, length) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === id ? { ...r, plan_view: planView, length } : r,
        ),
      },
      isDirty: true,
    })),

  cloneRoad: (id, newId, offsetXy) =>
    set((state) => {
      const source = state.project.roads.find((r) => r.id === id);
      if (!source) return state;
      const [dx, dy] = offsetXy;
      const cloned: Road = {
        ...(JSON.parse(JSON.stringify(source)) as Omit<Road, 'link'>),
        id: newId,
        link: { predecessor: null, successor: null },
        plan_view: source.plan_view.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
      };
      return {
        ...pushUndo(state),
        project: { ...state.project, roads: [...state.project.roads, cloned] },
        isDirty: true,
      };
    }),

  reverseRoad: (id) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road || road.plan_view.length === 0) return state;

      const normalizeAngle = (a: number): number => {
        let v = a;
        while (v > Math.PI) v -= 2 * Math.PI;
        while (v <= -Math.PI) v += 2 * Math.PI;
        return v;
      };

      /** Compute world-space end pose of a geometry segment. */
      const getEndPose = (g: Geometry): { x: number; y: number; hdg: number } => {
        const cosH = Math.cos(g.hdg);
        const sinH = Math.sin(g.hdg);
        const gt = g.geo_type;
        if (gt === 'Line') {
          return { x: g.x + g.length * cosH, y: g.y + g.length * sinH, hdg: g.hdg };
        }
        if (typeof gt === 'object' && 'Arc' in gt) {
          const k = gt.Arc.curvature;
          if (Math.abs(k) < 1e-15) {
            return { x: g.x + g.length * cosH, y: g.y + g.length * sinH, hdg: g.hdg };
          }
          const r = 1 / k;
          const theta = g.length * k;
          const lx = r * Math.sin(theta);
          const ly = r * (1 - Math.cos(theta));
          return {
            x: g.x + lx * cosH - ly * sinH,
            y: g.y + lx * sinH + ly * cosH,
            hdg: g.hdg + theta,
          };
        }
        // Spiral and parametric curves: approximate as line for end-pose
        return { x: g.x + g.length * cosH, y: g.y + g.length * sinH, hdg: g.hdg };
      };

      /** Reverse a geometry type for the reversed-direction segment. */
      const reverseGeoType = (gt: Geometry['geo_type']): Geometry['geo_type'] => {
        if (gt === 'Line') return 'Line';
        if (typeof gt === 'object' && 'Arc' in gt) {
          return { Arc: { curvature: -gt.Arc.curvature } };
        }
        if (typeof gt === 'object' && 'Spiral' in gt) {
          const s = gt.Spiral;
          return { Spiral: { curv_start: -s.curv_end, curv_end: -s.curv_start } };
        }
        return gt;
      };

      const endPoses = road.plan_view.map(getEndPose);
      let currentS = 0;
      const reversedPlanView: Geometry[] = road.plan_view
        .slice()
        .reverse()
        .map((geo, idx) => {
          const origIdx = road.plan_view.length - 1 - idx;
          const { x, y, hdg } = endPoses[origIdx]!;
          const newHdg = normalizeAngle(hdg + Math.PI);
          const g: Geometry = {
            s: currentS,
            x,
            y,
            hdg: newHdg,
            length: geo.length,
            geo_type: reverseGeoType(geo.geo_type),
          };
          currentS += geo.length;
          return g;
        });

      // Swap predecessor ↔ successor
      let newLink = road.link ? { ...road.link } : null;
      if (newLink) {
        const tmp = newLink.predecessor;
        newLink = { ...newLink, predecessor: newLink.successor, successor: tmp };
      }

      // Swap left ↔ right lanes and negate IDs
      const reversedSections = road.lane_sections.map((sec) => {
        const negateId = (l: Road['lane_sections'][0]['left'][0]) => ({ ...l, id: -l.id });
        return {
          ...sec,
          left: sec.right.map(negateId),
          right: sec.left.map(negateId),
          center: sec.center.map((l) => ({ ...l, id: l.id === 0 ? 0 : -l.id })),
        };
      });

      const updatedRoad: Road = {
        ...road,
        plan_view: reversedPlanView,
        link: newLink as Road['link'],
        lane_sections: reversedSections,
      };

      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  mirrorRoad: (id) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road) return state;

      const mirroredSections = road.lane_sections.map((sec) => {
        const negateId = (l: Road['lane_sections'][0]['left'][0]) => ({ ...l, id: -l.id });
        return {
          ...sec,
          left: sec.right.map(negateId),
          right: sec.left.map(negateId),
        };
      });

      const updatedRoad: Road = { ...road, lane_sections: mirroredSections };
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  optimizeRoad: (id) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road || road.plan_view.length < 2) return state;

      // Frontend-side Douglas–Peucker on plan_view x/y start points
      const epsilon = 0.01;
      const pts = road.plan_view.map((g) => ({ x: g.x, y: g.y, geo: g }));

      const dpKeep = new Array(pts.length).fill(true);
      function dpRecurse(start: number, end: number): void {
        if (end <= start + 1) return;
        const ax = pts[start]!.x, ay = pts[start]!.y;
        const bx = pts[end]!.x, by = pts[end]!.y;
        const dx = bx - ax, dy = by - ay;
        const chordLen = Math.sqrt(dx * dx + dy * dy);
        let maxDist = 0, maxIdx = start;
        for (let i = start + 1; i < end; i++) {
          const px = pts[i]!.x - ax, py = pts[i]!.y - ay;
          const dist = chordLen < 1e-9
            ? Math.sqrt(px * px + py * py)
            : Math.abs(px * dy - py * dx) / chordLen;
          if (dist > maxDist) { maxDist = dist; maxIdx = i; }
        }
        if (maxDist < epsilon) {
          for (let i = start + 1; i < end; i++) dpKeep[i] = false;
        } else {
          dpRecurse(start, maxIdx);
          dpRecurse(maxIdx, end);
        }
      }
      dpRecurse(0, pts.length - 1);

      const keptGeos = road.plan_view.filter((_, i) => dpKeep[i]);
      if (keptGeos.length === road.plan_view.length) return state; // nothing to do

      // Renumber s values
      let s = 0;
      const optimizedGeos: Geometry[] = keptGeos.map((g) => {
        const ng = { ...g, s };
        s += g.length;
        return ng;
      });
      const newLength = optimizedGeos.reduce((acc, g) => acc + g.length, 0);

      const updatedRoad: Road = { ...road, plan_view: optimizedGeos, length: newLength };
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  swapCenterline: (id, targetLaneId) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road || targetLaneId === 0) return state;

      const section = road.lane_sections[0];
      if (!section) return state;

      // Compute cumulative lateral offset to the outer edge of targetLaneId
      const lanes = targetLaneId > 0 ? section.left : section.right;
      const absId = Math.abs(targetLaneId);
      let cumulativeWidth = 0;
      for (const lane of lanes) {
        if (Math.abs(lane.id) <= absId) {
          cumulativeWidth += lane.width[0]?.a ?? 0;
        }
      }
      const T = targetLaneId > 0 ? cumulativeWidth : -cumulativeWidth;

      // Offset each geometry segment perpendicular to its heading by T
      const newPlanView = road.plan_view.map((geo) => {
        const nx = -Math.sin(geo.hdg);
        const ny = Math.cos(geo.hdg);
        return { ...geo, x: geo.x + T * nx, y: geo.y + T * ny };
      });

      // Rebuild lane sections around the new centerline
      const newSections = road.lane_sections.map((sec) => {
        if (targetLaneId > 0) {
          const outsideLeft = sec.left
            .filter((l) => l.id > targetLaneId)
            .map((l, i) => ({ ...l, id: i + 1 }));
          const newRight = [...sec.left.filter((l) => l.id <= targetLaneId).reverse(), ...sec.right]
            .map((l, i) => ({ ...l, id: -(i + 1) }));
          return { ...sec, left: outsideLeft, right: newRight };
        } else {
          const absTarget = Math.abs(targetLaneId);
          const outsideRight = sec.right
            .filter((l) => Math.abs(l.id) > absTarget)
            .map((l, i) => ({ ...l, id: -(i + 1) }));
          const newLeft = [...sec.right.filter((l) => Math.abs(l.id) <= absTarget).reverse(), ...sec.left]
            .map((l, i) => ({ ...l, id: i + 1 }));
          return { ...sec, right: outsideRight, left: newLeft };
        }
      });

      const updatedRoad: Road = {
        ...road,
        plan_view: newPlanView,
        lane_sections: newSections,
        link: null,
      };
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  moveRoad: (id, dx, dy) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road) return state;
      const updatedRoad: Road = {
        ...road,
        plan_view: road.plan_view.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
      };
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  rotateRoad: (id, angle, cx, cy) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === id);
      if (!road || road.plan_view.length === 0) return state;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const updatedRoad: Road = {
        ...road,
        plan_view: road.plan_view.map((g) => {
          const rx = g.x - cx;
          const ry = g.y - cy;
          return {
            ...g,
            x: cx + rx * cosA - ry * sinA,
            y: cy + rx * sinA + ry * cosA,
            hdg: g.hdg + angle,
          };
        }),
      };
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => (r.id === id ? updatedRoad : r)),
        },
        isDirty: true,
      };
    }),

  updateJunction: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        junctions: state.project.junctions.map((j) =>
          j.id === id ? { ...j, ...updates } : j,
        ),
      },
      isDirty: true,
    })),

  addJunctionWithRoads: (junction, roads) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: [...state.project.roads, ...roads],
        junctions: [...state.project.junctions, junction],
      },
      isDirty: true,
    })),

  addSignal: (signal) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: [...(state.project.signals || []), signal],
      },
      isDirty: true,
    })),

  removeSignal: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: (state.project.signals || []).filter((s) => s.id !== id),
      },
      isDirty: true,
    })),

  updateSignal: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: (state.project.signals || []).map((s) =>
          s.id === id ? { ...s, ...updates } : s,
        ),
      },
      isDirty: true,
    })),

  addObject: (obj) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: [...(state.project.objects || []), obj],
      },
      isDirty: true,
    })),

  removeObject: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: (state.project.objects || []).filter((o) => o.id !== id),
      },
      isDirty: true,
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: (state.project.objects || []).map((o) =>
          o.id === id ? { ...o, ...updates } : o,
        ),
      },
      isDirty: true,
    })),

  updateLaneType: (roadId, sectionIndex, side, laneId, laneType) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) =>
            l.id === laneId ? { ...l, lane_type: laneType } : l,
          );
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  updateLaneWidth: (roadId, sectionIndex, side, laneId, width) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) =>
            l.id === laneId ? { ...l, width: [width] } : l,
          );
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  addElevationPoint: (roadId, s, height) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const next = [
            ...r.elevation_profile,
            { s, a: height, b: 0, c: 0, d: 0 },
          ].sort((a, b) => a.s - b.s);
          return { ...r, elevation_profile: next };
        }),
      },
      isDirty: true,
    })),

  updateElevationPoint: (roadId, index, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (index < 0 || index >= r.elevation_profile.length) return r;
          const elevation_profile = r.elevation_profile
            .map((p, i) => (i === index ? { ...p, ...updates } : p))
            .sort((a, b) => a.s - b.s);
          return { ...r, elevation_profile };
        }),
      },
      isDirty: true,
    })),

  removeElevationPoint: (roadId, index) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (index < 0 || index >= r.elevation_profile.length) return r;
          return {
            ...r,
            elevation_profile: r.elevation_profile.filter((_, i) => i !== index),
          };
        }),
      },
      isDirty: true,
    })),

  removeLane: (roadId, sectionIndex, side, laneId) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          return {
            ...r,
            lane_sections: r.lane_sections.map((ls, si) => {
              if (si !== sectionIndex) return ls;
              return {
                ...ls,
                [side]: ls[side].filter((l) => l.id !== laneId),
              };
            }),
          };
        }),
      },
      isDirty: true,
    })),

  smoothElevation: (roadId, iterations = 1) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (r.elevation_profile.length < 3) return r;

          let next = [...r.elevation_profile];
          for (let iter = 0; iter < Math.max(1, iterations); iter += 1) {
            const prev = [...next];
            next = next.map((entry, i) => {
              if (i === 0 || i === prev.length - 1) {
                return entry;
              }
              const avgA = (prev[i - 1]!.a + prev[i]!.a + prev[i + 1]!.a) / 3;
              return { ...entry, a: avgA };
            });
          }

          return { ...r, elevation_profile: next };
        }),
      },
      isDirty: true,
    })),

  setCursorWorldPos: (pos) => set((s) => {
    if (s.cursorWorldPos.x === pos.x && s.cursorWorldPos.y === pos.y) return s;
    return { cursorWorldPos: pos };
  }),
  setViewportInfo: ({ gridSpacing, mpp }) => set((s) => {
    if (s.gridSpacing === gridSpacing && s.viewportMpp === mpp) return s;
    return { gridSpacing, viewportMpp: mpp };
  }),

  markDirty: () => set({ isDirty: true }),
  markClean: () => set((s) => ({ isDirty: false, savedProject: s.project })),
  resetToSaved: () => set((s) => s.savedProject
    ? { project: s.savedProject, isDirty: false, undoStack: [], redoStack: [], selectedRoadId: null, selectedJunctionId: null, selectedObjectType: null, selectedSceneNode: null, selectedRoadIds: [], selectedJunctionIds: [] }
    : s),
  reset: () => set((s) => ({ project: initialProject, isDirty: false, selectedRoadId: null, selectedJunctionId: null, selectedObjectType: null, selectedSceneNode: null, selectedRoadIds: [], selectedJunctionIds: [], clipboardRoadId: null, undoStack: [], redoStack: [], cursorWorldPos: { x: 0, y: 0 }, gridSpacing: 10.0, viewportMpp: 0.1, projectLoadVersion: s.projectLoadVersion + 1 })),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        project: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, structuredClone(state.project)],
        isDirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        project: next,
        undoStack: [...state.undoStack, structuredClone(state.project)],
        redoStack: state.redoStack.slice(0, -1),
        isDirty: true,
      };
    }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  executePluginCommand: (_description, executeFn) =>
    set((state) => {
      const newProject = executeFn(state.project);
      return {
        ...pushUndo(state),
        project: newProject,
        isDirty: true,
      };
    }),
}));
