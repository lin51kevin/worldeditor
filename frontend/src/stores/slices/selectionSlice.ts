import type { EditorState, LaneSide, SceneNodeSelection, SliceCreator } from './types';
import { pushUndo } from './types';

export interface SelectionSlice {
  selectedRoadId: string | null;
  selectedJunctionId: string | null;
  selectedObjectType: 'road' | 'junction' | null;
  selectedSceneNode: SceneNodeSelection | null;
  selectedLaneSectionIndex: number | null;
  selectedLaneId: number | null;
  selectedRoadIds: string[];
  selectedJunctionIds: string[];
  clipboardRoadId: string | null;

  selectRoad: (id: string | null) => void;
  selectJunction: (id: string | null) => void;
  selectMultiple: (roadIds: string[], junctionIds: string[]) => void;
  setSelectedLaneSection: (roadId: string, sectionIndex: number | null) => void;
  setSelectedLane: (roadId: string, sectionIndex: number, laneId: number | null) => void;
  clearLaneSelection: () => void;
  selectLaneSection: (roadId: string, sectionIndex: number) => void;
  selectLane: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  selectSignal: (roadId: string, signalId: string) => void;
  selectObject: (roadId: string, objectId: string) => void;
  selectAll: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteFromClipboard: () => void;
}

function createLaneSectionSelection(roadId: string, sectionIndex: number): Partial<SelectionSlice> {
  return {
    selectedRoadId: roadId,
    selectedJunctionId: null,
    selectedObjectType: 'road',
    selectedSceneNode: { type: 'laneSection', roadId, sectionIndex },
    selectedLaneSectionIndex: sectionIndex,
    selectedLaneId: null,
    selectedRoadIds: [],
    selectedJunctionIds: [],
  };
}

function createLaneSelection(roadId: string, sectionIndex: number, side: LaneSide, laneId: number): Partial<SelectionSlice> {
  return {
    selectedRoadId: roadId,
    selectedJunctionId: null,
    selectedObjectType: 'road',
    selectedSceneNode: { type: 'lane', roadId, sectionIndex, side, laneId },
    selectedLaneSectionIndex: sectionIndex,
    selectedLaneId: laneId,
    selectedRoadIds: [],
    selectedJunctionIds: [],
  };
}

export const createSelectionSlice: SliceCreator<SelectionSlice> = (set, get) => ({
  selectedRoadId: null,
  selectedJunctionId: null,
  selectedObjectType: null,
  selectedSceneNode: null,
  selectedLaneSectionIndex: null,
  selectedLaneId: null,
  selectedRoadIds: [],
  selectedJunctionIds: [],
  clipboardRoadId: null,

  selectRoad: (id) =>
    set({
      selectedRoadId: id,
      selectedJunctionId: null,
      selectedObjectType: id ? 'road' : null,
      selectedSceneNode: id ? { type: 'road', roadId: id } : null,
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
    }),

  selectJunction: (id) =>
    set({
      selectedJunctionId: id,
      selectedRoadId: null,
      selectedObjectType: id ? 'junction' : null,
      selectedSceneNode: id ? { type: 'junction', junctionId: id } : null,
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
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
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
    }),

  setSelectedLaneSection: (roadId, sectionIndex) =>
    set(
      sectionIndex === null
        ? {
            selectedRoadId: roadId,
            selectedJunctionId: null,
            selectedObjectType: 'road',
            selectedSceneNode: { type: 'road', roadId },
            selectedLaneSectionIndex: null,
            selectedLaneId: null,
            selectedRoadIds: [],
            selectedJunctionIds: [],
          }
        : createLaneSectionSelection(roadId, sectionIndex),
    ),

  setSelectedLane: (roadId, sectionIndex, laneId) =>
    set(
      laneId === null
        ? createLaneSectionSelection(roadId, sectionIndex)
        : createLaneSelection(roadId, sectionIndex, laneId > 0 ? 'left' : 'right', laneId),
    ),

  clearLaneSelection: () =>
    set((state) => ({
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
      selectedSceneNode:
        state.selectedSceneNode?.type === 'lane' || state.selectedSceneNode?.type === 'laneSection'
          ? (state.selectedRoadId ? { type: 'road', roadId: state.selectedRoadId } : null)
          : state.selectedSceneNode,
    })),

  selectLaneSection: (roadId, sectionIndex) =>
    set(createLaneSectionSelection(roadId, sectionIndex)),

  selectLane: (roadId, sectionIndex, side, laneId) =>
    set(createLaneSelection(roadId, sectionIndex, side, laneId)),

  selectSignal: (roadId, signalId) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'signal', roadId, signalId },
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
    }),

  selectObject: (roadId, objectId) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'object', roadId, objectId },
      selectedLaneSectionIndex: null,
      selectedLaneId: null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
    }),

  selectAll: () => {
    const { project } = get();
    const roadIds = project.roads.map((r) => r.id);
    const junctionIds = project.junctions.map((j) => j.id);
    get().selectMultiple(roadIds, junctionIds);
  },

  deleteSelected: () => {
    const state = get();
    // Multi-select takes priority
    if (state.selectedRoadIds.length > 0 || state.selectedJunctionIds.length > 0) {
      const { selectedRoadIds, selectedJunctionIds } = state;
      set((s: EditorState) => ({
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
    if (state.selectedSceneNode?.type === 'signal') {
      get().removeSignal(state.selectedSceneNode.signalId);
      return;
    }
    if (state.selectedSceneNode?.type === 'object') {
      get().removeObject(state.selectedSceneNode.objectId);
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
});
