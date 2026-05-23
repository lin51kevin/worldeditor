import type { Geometry, Junction, Road, RoadSignal, RoadObject, RoadObjectItem } from '../../services/platform';
import type { EditorState, SliceCreator } from './types';
import { pushUndo } from './types';

export interface RoadSlice {
  addRoad: (road: Road) => void;
  removeRoad: (id: string) => void;
  updateRoad: (id: string, updates: Partial<Pick<Road, 'name' | 'length' | 'junction_id'>>) => void;
  updateRoadGeometry: (id: string, planView: Geometry[], length: number, splineEditData?: [number, number, number][]) => void;
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
  addSignal: (signal: RoadSignal) => void;
  removeSignal: (id: string) => void;
  updateSignal: (id: string, updates: Partial<RoadSignal>) => void;
  addObject: (obj: RoadObject) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<RoadObject>) => void;
  /** Place a RoadObjectItem directly onto a road's objects[] array. */
  addRoadObjectItem: (roadId: string, obj: RoadObjectItem) => void;
  /** Place a RoadSignal directly onto a road's signals[] array. */
  addRoadSignalItem: (roadId: string, signal: RoadSignal) => void;
}

export const createRoadSlice: SliceCreator<RoadSlice> = (set) => ({
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

  updateRoadGeometry: (id, planView, length, splineEditData) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === id
            ? {
                ...r,
                plan_view: planView,
                length,
                ...(splineEditData !== undefined ? { spline_edit_data: splineEditData } : {}),
              }
            : r,
        ),
      },
      isDirty: true,
    })),

  cloneRoad: (id, newId, offsetXy) =>
    set((state) => {
      const source = state.project.roads.find((r) => r.id === id);
      if (!source) return state as Partial<EditorState>;
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
      if (!road || road.plan_view.length === 0) return state as Partial<EditorState>;

      const normalizeAngle = (a: number): number => {
        let v = a;
        while (v > Math.PI) v -= 2 * Math.PI;
        while (v <= -Math.PI) v += 2 * Math.PI;
        return v;
      };

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
        return { x: g.x + g.length * cosH, y: g.y + g.length * sinH, hdg: g.hdg };
      };

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

      let newLink = road.link ? { ...road.link } : null;
      if (newLink) {
        const tmp = newLink.predecessor;
        newLink = { ...newLink, predecessor: newLink.successor, successor: tmp };
      }

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
      if (!road) return state as Partial<EditorState>;

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
      if (!road || road.plan_view.length < 2) return state as Partial<EditorState>;

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
      if (keptGeos.length === road.plan_view.length) return state as Partial<EditorState>;

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
      if (!road || targetLaneId === 0) return state as Partial<EditorState>;

      const section = road.lane_sections[0];
      if (!section) return state as Partial<EditorState>;

      const lanes = targetLaneId > 0 ? section.left : section.right;
      const absId = Math.abs(targetLaneId);
      let cumulativeWidth = 0;
      for (const lane of lanes) {
        if (Math.abs(lane.id) <= absId) {
          cumulativeWidth += lane.width[0]?.a ?? 0;
        }
      }
      const T = targetLaneId > 0 ? cumulativeWidth : -cumulativeWidth;

      const newPlanView = road.plan_view.map((geo) => {
        const nx = -Math.sin(geo.hdg);
        const ny = Math.cos(geo.hdg);
        return { ...geo, x: geo.x + T * nx, y: geo.y + T * ny };
      });

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
      if (!road) return state as Partial<EditorState>;
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
      if (!road || road.plan_view.length === 0) return state as Partial<EditorState>;
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

  addRoadObjectItem: (roadId, obj) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === roadId
            ? { ...r, objects: [...(r.objects ?? []), obj] }
            : r,
        ),
      },
      isDirty: true,
    })),

  addRoadSignalItem: (roadId, signal) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === roadId
            ? { ...r, signals: [...(r.signals ?? []), signal] }
            : r,
        ),
      },
      isDirty: true,
    })),
});
