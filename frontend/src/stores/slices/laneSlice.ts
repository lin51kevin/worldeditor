import type { Crossfall, Elevation, Lane, LaneLink, LaneWidth, Road, Superelevation } from '../../services/platform';
import type { EditorState, SliceCreator } from './types';
import { pushUndo } from './types';

export interface LaneSlice {
  updateLaneType: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, laneType: string) => void;
  updateLaneWidth: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, width: LaneWidth) => void;
  removeLane: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number) => void;
  addLane: (roadId: string, sectionIndex: number, side: 'left' | 'right') => void;
  addRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, mark: import('../../services/platform').RoadMark) => void;
  updateRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, markIndex: number, updates: Partial<import('../../services/platform').RoadMark>) => void;
  removeRoadMark: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, markIndex: number) => void;
  addLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, border: import('../../services/platform').LaneBorder) => void;
  updateLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, borderIndex: number, updates: Partial<import('../../services/platform').LaneBorder>) => void;
  removeLaneBorder: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, borderIndex: number) => void;
  addElevationPoint: (roadId: string, s: number, height: number) => void;
  updateElevationPoint: (roadId: string, index: number, updates: Partial<Elevation>) => void;
  removeElevationPoint: (roadId: string, index: number) => void;
  addSuperelevation: (roadId: string, record: Superelevation) => void;
  updateSuperelevation: (roadId: string, index: number, updates: Partial<Superelevation>) => void;
  removeSuperelevation: (roadId: string, index: number) => void;
  addCrossfall: (roadId: string, record: Crossfall) => void;
  updateCrossfall: (roadId: string, index: number, record: Partial<Crossfall>) => void;
  removeCrossfall: (roadId: string, index: number) => void;
  smoothElevation: (roadId: string, iterations?: number) => void;
}

const sortByS = <T extends { s: number }>(records: T[]): T[] =>
  [...records].sort((a, b) => a.s - b.s);

const getRoadSuperelevations = (road: Road): Superelevation[] =>
  road.lateral_profile?.superelevation ?? road.lateral_profile?.superelevations ?? [];

const getRoadCrossfalls = (road: Road): Crossfall[] =>
  road.lateral_profile?.crossfall ?? road.lateral_profile?.crossfalls ?? [];

const withSuperelevations = (road: Road, superelevation: Superelevation[]): Road => {
  const crossfall = getRoadCrossfalls(road);
  return {
    ...road,
    lateral_profile: {
      ...road.lateral_profile,
      superelevation,
      superelevations: superelevation,
      crossfall,
      crossfalls: crossfall,
    },
  };
};

const withCrossfalls = (road: Road, crossfall: Crossfall[]): Road => {
  const superelevation = getRoadSuperelevations(road);
  return {
    ...road,
    lateral_profile: {
      ...road.lateral_profile,
      superelevation,
      superelevations: superelevation,
      crossfall,
      crossfalls: crossfall,
    },
  };
};

export const createLaneSlice: SliceCreator<LaneSlice> = (set, _get) => ({
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

  addLane: (roadId, sectionIndex, side) =>
    set((state) => {
      const road = state.project.roads.find((r) => r.id === roadId);
      if (!road) return state as Partial<EditorState>;
      const section = road.lane_sections[sectionIndex];
      if (!section) return state as Partial<EditorState>;

      const existingIds = section[side].map((l) => l.id);
      const newId = side === 'left'
        ? (existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1)
        : (existingIds.length === 0 ? -1 : Math.min(...existingIds) - 1);

      const link: LaneLink = { predecessor: null, successor: null };
      const newLane: Lane = {
        id: newId,
        lane_type: 'Driving',
        level: 0,
        link,
        width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
        borders: [],
        road_marks: [],
      };

      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => {
            if (r.id !== roadId) return r;
            return {
              ...r,
              lane_sections: r.lane_sections.map((ls, si) => {
                if (si !== sectionIndex) return ls;
                return { ...ls, [side]: [...ls[side], newLane] };
              }),
            };
          }),
        },
        isDirty: true,
      };
    }),

  addRoadMark: (roadId, sectionIndex, side, laneId, mark) =>
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
            l.id === laneId
              ? { ...l, road_marks: [...l.road_marks, mark].sort((a, b) => a.s_offset - b.s_offset) }
              : l,
          );
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  updateRoadMark: (roadId, sectionIndex, side, laneId, markIndex, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) => {
            if (l.id !== laneId) return l;
            const marks = [...l.road_marks];
            if (markIndex >= 0 && markIndex < marks.length) {
              marks[markIndex] = { ...marks[markIndex]!, ...updates };
            }
            return { ...l, road_marks: marks };
          });
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  removeRoadMark: (roadId, sectionIndex, side, laneId, markIndex) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) => {
            if (l.id !== laneId) return l;
            return { ...l, road_marks: l.road_marks.filter((_, i) => i !== markIndex) };
          });
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  addLaneBorder: (roadId, sectionIndex, side, laneId, border) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) => {
            if (l.id !== laneId) return l;
            const borders = l.borders ? [...l.borders, border].sort((a, b) => a.s_offset - b.s_offset) : [border];
            return { ...l, borders };
          });
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  updateLaneBorder: (roadId, sectionIndex, side, laneId, borderIndex, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) => {
            if (l.id !== laneId || !l.borders) return l;
            const borders = [...l.borders];
            if (borderIndex >= 0 && borderIndex < borders.length) {
              borders[borderIndex] = { ...borders[borderIndex]!, ...updates };
            }
            return { ...l, borders };
          });
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  removeLaneBorder: (roadId, sectionIndex, side, laneId, borderIndex) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l) => {
            if (l.id !== laneId || !l.borders) return l;
            return { ...l, borders: l.borders.filter((_, i) => i !== borderIndex) };
          });
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

  addSuperelevation: (roadId, record) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          return withSuperelevations(r, sortByS([...getRoadSuperelevations(r), record]));
        }),
      },
      isDirty: true,
    })),

  updateSuperelevation: (roadId, index, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const profile = getRoadSuperelevations(r);
          if (index < 0 || index >= profile.length) return r;
          return withSuperelevations(
            r,
            sortByS(profile.map((entry, i) => (i === index ? { ...entry, ...updates } : entry))),
          );
        }),
      },
      isDirty: true,
    })),

  removeSuperelevation: (roadId, index) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const profile = getRoadSuperelevations(r);
          if (index < 0 || index >= profile.length) return r;
          return withSuperelevations(r, profile.filter((_, i) => i !== index));
        }),
      },
      isDirty: true,
    })),

  addCrossfall: (roadId, record) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          return withCrossfalls(r, sortByS([...getRoadCrossfalls(r), record]));
        }),
      },
      isDirty: true,
    })),

  updateCrossfall: (roadId, index, record) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const profile = getRoadCrossfalls(r);
          if (index < 0 || index >= profile.length) return r;
          return withCrossfalls(
            r,
            sortByS(profile.map((entry, i) => (i === index ? { ...entry, ...record } : entry))),
          );
        }),
      },
      isDirty: true,
    })),

  removeCrossfall: (roadId, index) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const profile = getRoadCrossfalls(r);
          if (index < 0 || index >= profile.length) return r;
          return withCrossfalls(r, profile.filter((_, i) => i !== index));
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
});
