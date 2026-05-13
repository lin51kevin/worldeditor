import type { Lane, LaneSection, Project, Road } from '../services/platform';

export type LaneSide = 'left' | 'right';

export type SceneNodeSelection =
  | { type: 'road'; roadId: string }
  | { type: 'laneSection'; roadId: string; sectionIndex: number }
  | { type: 'lane'; roadId: string; sectionIndex: number; side: LaneSide; laneId: number }
  | { type: 'junction'; junctionId: string }
  | { type: 'signal'; roadId: string; signalId: string };

export interface SceneVisibilityState {
  hiddenRoadIds: string[];
  hiddenJunctionIds: string[];
  hiddenLaneSectionKeys: string[];
  hiddenLaneKeys: string[];
}

export function makeLaneSectionKey(roadId: string, sectionIndex: number): string {
  return `${roadId}::section::${sectionIndex}`;
}

export function makeLaneKey(
  roadId: string,
  sectionIndex: number,
  side: LaneSide,
  laneId: number,
): string {
  return `${roadId}::section::${sectionIndex}::${side}::${laneId}`;
}

function cloneLane(lane: Lane, renderHidden: boolean): Lane {
  return { ...lane, render_hidden: renderHidden };
}

function cloneLaneSection(
  roadId: string,
  section: LaneSection,
  sectionIndex: number,
  hiddenLaneSectionKeys: Set<string>,
  hiddenLaneKeys: Set<string>,
): LaneSection {
  const sectionKey = makeLaneSectionKey(roadId, sectionIndex);
  const sectionHidden = hiddenLaneSectionKeys.has(sectionKey);

  return {
    ...section,
    render_hidden: sectionHidden,
    left: section.left.map((lane) => cloneLane(
      lane,
      sectionHidden || hiddenLaneKeys.has(makeLaneKey(roadId, sectionIndex, 'left', lane.id)),
    )),
    center: section.center.map((lane) => cloneLane(lane, sectionHidden)),
    right: section.right.map((lane) => cloneLane(
      lane,
      sectionHidden || hiddenLaneKeys.has(makeLaneKey(roadId, sectionIndex, 'right', lane.id)),
    )),
  };
}

function cloneRoad(
  road: Road,
  hiddenLaneSectionKeys: Set<string>,
  hiddenLaneKeys: Set<string>,
): Road {
  const laneSections = road.lane_sections.map((section, sectionIndex) =>
    cloneLaneSection(road.id, section, sectionIndex, hiddenLaneSectionKeys, hiddenLaneKeys),
  );

  return {
    ...road,
    render_hidden: road.render_hidden === true
      || (road.lane_sections.length > 0 && laneSections.every((section) => section.render_hidden === true)),
    lane_sections: laneSections,
  };
}

export function buildRenderableProject(
  project: Project,
  visibility: SceneVisibilityState,
): Project {
  const hiddenRoadSet = new Set(visibility.hiddenRoadIds);
  const hiddenJunctionSet = new Set(visibility.hiddenJunctionIds);
  const hiddenLaneSectionKeys = new Set(visibility.hiddenLaneSectionKeys);
  const hiddenLaneKeys = new Set(visibility.hiddenLaneKeys);

  const roads = project.roads
    .filter((road) => !hiddenRoadSet.has(road.id))
    .map((road) => cloneRoad(road, hiddenLaneSectionKeys, hiddenLaneKeys));
  const roadIds = new Set(roads.map((road) => road.id));
  const junctions = project.junctions
    .filter((junction) => !hiddenJunctionSet.has(junction.id))
    .map((junction) => ({
      ...junction,
      connections: junction.connections.filter((connection) =>
        roadIds.has(connection.incoming_road) && roadIds.has(connection.connecting_road),
      ),
    }))
    .filter((junction) => junction.connections.length > 0);

  return { ...project, roads, junctions };
}

export function buildHighlightProject(
  project: Project,
  selection: SceneNodeSelection | null,
): Project | null {
  if (!selection || selection.type === 'junction') {
    return null;
  }

  const road = project.roads.find((candidate) => candidate.id === selection.roadId);
  if (!road) {
    return null;
  }

  const hiddenLaneSectionKeys = new Set<string>();
  const hiddenLaneKeys = new Set<string>();

  if (selection.type === 'laneSection' || selection.type === 'lane') {
    road.lane_sections.forEach((_, index) => {
      if (index !== selection.sectionIndex) {
        hiddenLaneSectionKeys.add(makeLaneSectionKey(road.id, index));
      }
    });
  }

  if (selection.type === 'lane') {
    const selectedSection = road.lane_sections[selection.sectionIndex];
    if (!selectedSection) {
      return null;
    }

    (['left', 'right'] as const).forEach((side) => {
      selectedSection[side].forEach((lane) => {
        if (!(side === selection.side && lane.id === selection.laneId)) {
          hiddenLaneKeys.add(makeLaneKey(road.id, selection.sectionIndex, side, lane.id));
        }
      });
    });
  }

  return {
    ...project,
    roads: [cloneRoad(road, hiddenLaneSectionKeys, hiddenLaneKeys)],
    junctions: [],
    signals: [],
    objects: []
  };
}

export function isSceneSelectionVisible(
  selection: SceneNodeSelection | null,
  visibility: SceneVisibilityState,
): boolean {
  if (!selection) {
    return false;
  }

  if (selection.type === 'junction') {
    return !visibility.hiddenJunctionIds.includes(selection.junctionId);
  }

  if (visibility.hiddenRoadIds.includes(selection.roadId)) {
    return false;
  }

  if (selection.type === 'road') {
    return true;
  }

  // Signal visibility follows the road's visibility
  if (selection.type === 'signal') {
    return true;
  }

  const sectionKey = makeLaneSectionKey(selection.roadId, selection.sectionIndex);
  if (visibility.hiddenLaneSectionKeys.includes(sectionKey)) {
    return false;
  }

  if (selection.type === 'lane') {
    return !visibility.hiddenLaneKeys.includes(
      makeLaneKey(selection.roadId, selection.sectionIndex, selection.side, selection.laneId),
    );
  }

  return true;
}

export function tintVertices(
  vertices: Float32Array,
  color: [number, number, number, number],
): Float32Array {
  const tinted = new Float32Array(vertices);
  for (let index = 3; index < tinted.length; index += 7) {
    tinted[index] = color[0];
    tinted[index + 1] = color[1];
    tinted[index + 2] = color[2];
    tinted[index + 3] = color[3];
  }
  return tinted;
}
