/**
 * connectivity.ts — Resolves predecessor/successor connections for a given
 * scene selection (road, lane section, or lane).
 *
 * Used by the T-key road link highlight to show context-sensitive connectivity.
 */
import type { Project, Lane, LaneSection } from '../services/platform';
import type { SceneNodeSelection, LaneSide } from './sceneGraph';

/** Connectivity result with separate predecessor and successor lists. */
export interface ConnectivityResult {
  predecessors: SceneNodeSelection[];
  successors: SceneNodeSelection[];
}

/**
 * Resolve predecessor/successor scene nodes for a given selection.
 *
 * - Road → predecessor/successor roads (via road.link)
 * - LaneSection → adjacent sections within the same road + connected sections
 *   across road boundaries
 * - Lane → lanes linked via lane.link.predecessor/successor, resolved within
 *   the same road or across road boundaries
 */
export function resolveConnectivity(
  project: Project,
  selection: SceneNodeSelection | null,
): ConnectivityResult {
  const empty: ConnectivityResult = { predecessors: [], successors: [] };
  if (!selection) return empty;

  switch (selection.type) {
    case 'road':
      return resolveRoadConnectivity(project, selection.roadId);
    case 'laneSection':
      return resolveLaneSectionConnectivity(
        project, selection.roadId, selection.sectionIndex,
      );
    case 'lane':
      return resolveLaneConnectivity(
        project, selection.roadId, selection.sectionIndex,
        selection.side, selection.laneId,
      );
    default:
      return empty;
  }
}

// ── Road-level connectivity ─────────────────────────────────────────────────

function resolveRoadConnectivity(
  project: Project,
  roadId: string,
): ConnectivityResult {
  const road = project.roads.find((r) => r.id === roadId);
  if (!road?.link) return { predecessors: [], successors: [] };

  const predecessors: SceneNodeSelection[] = [];
  const successors: SceneNodeSelection[] = [];

  const { predecessor, successor } = road.link;

  if (predecessor?.element_type === 'Road') {
    if (project.roads.some((r) => r.id === predecessor.element_id)) {
      predecessors.push({ type: 'road', roadId: predecessor.element_id });
    }
  }
  if (successor?.element_type === 'Road') {
    if (project.roads.some((r) => r.id === successor.element_id)) {
      successors.push({ type: 'road', roadId: successor.element_id });
    }
  }

  return { predecessors, successors };
}

// ── LaneSection-level connectivity ──────────────────────────────────────────

function resolveLaneSectionConnectivity(
  project: Project,
  roadId: string,
  sectionIndex: number,
): ConnectivityResult {
  const road = project.roads.find((r) => r.id === roadId);
  if (!road) return { predecessors: [], successors: [] };

  const predecessors: SceneNodeSelection[] = [];
  const successors: SceneNodeSelection[] = [];

  // Within same road: adjacent sections
  if (sectionIndex > 0) {
    predecessors.push({ type: 'laneSection', roadId, sectionIndex: sectionIndex - 1 });
  }
  if (sectionIndex < road.lane_sections.length - 1) {
    successors.push({ type: 'laneSection', roadId, sectionIndex: sectionIndex + 1 });
  }

  // Across road boundary: predecessor road (first section is at road start)
  if (sectionIndex === 0 && road.link?.predecessor?.element_type === 'Road') {
    const predRoad = project.roads.find((r) => r.id === road.link!.predecessor!.element_id);
    if (predRoad && predRoad.lane_sections.length > 0) {
      const contactPoint = road.link.predecessor.contact_point;
      const predSectionIndex = contactPoint === 'Start'
        ? 0
        : predRoad.lane_sections.length - 1;
      predecessors.push({
        type: 'laneSection',
        roadId: predRoad.id,
        sectionIndex: predSectionIndex,
      });
    }
  }

  // Across road boundary: successor road (last section is at road end)
  const lastIndex = road.lane_sections.length - 1;
  if (sectionIndex === lastIndex && road.link?.successor?.element_type === 'Road') {
    const succRoad = project.roads.find((r) => r.id === road.link!.successor!.element_id);
    if (succRoad && succRoad.lane_sections.length > 0) {
      const contactPoint = road.link.successor.contact_point;
      const succSectionIndex = contactPoint === 'Start'
        ? 0
        : succRoad.lane_sections.length - 1;
      successors.push({
        type: 'laneSection',
        roadId: succRoad.id,
        sectionIndex: succSectionIndex,
      });
    }
  }

  return { predecessors, successors };
}

// ── Lane-level connectivity ─────────────────────────────────────────────────

/** Determine the side ('left' | 'right') of a lane by its numeric id. */
function laneSide(laneId: number): LaneSide {
  return laneId > 0 ? 'left' : 'right';
}

/** Find a lane in a section by numeric id. */
function findLaneInSection(section: LaneSection, laneId: number): Lane | undefined {
  const side = laneId > 0 ? section.left : section.right;
  return side.find((l) => l.id === laneId);
}

function resolveLaneConnectivity(
  project: Project,
  roadId: string,
  sectionIndex: number,
  side: LaneSide,
  laneId: number,
): ConnectivityResult {
  const road = project.roads.find((r) => r.id === roadId);
  if (!road) return { predecessors: [], successors: [] };

  const section = road.lane_sections[sectionIndex];
  if (!section) return { predecessors: [], successors: [] };

  const lanes = side === 'left' ? section.left : section.right;
  const lane = lanes.find((l) => l.id === laneId);
  if (!lane) return { predecessors: [], successors: [] };

  const predecessors: SceneNodeSelection[] = [];
  const successors: SceneNodeSelection[] = [];

  // Within same road: predecessor lane is in the previous section
  if (lane.link?.predecessor != null && sectionIndex > 0) {
    const predSection = road.lane_sections[sectionIndex - 1];
    if (predSection) {
      const predLaneId = lane.link.predecessor;
      const predLane = findLaneInSection(predSection, predLaneId);
      if (predLane) {
        predecessors.push({
          type: 'lane',
          roadId,
          sectionIndex: sectionIndex - 1,
          side: laneSide(predLaneId),
          laneId: predLaneId,
        });
      }
    }
  }

  // Within same road: successor lane is in the next section
  if (lane.link?.successor != null && sectionIndex < road.lane_sections.length - 1) {
    const succSection = road.lane_sections[sectionIndex + 1];
    if (succSection) {
      const succLaneId = lane.link.successor;
      const succLane = findLaneInSection(succSection, succLaneId);
      if (succLane) {
        successors.push({
          type: 'lane',
          roadId,
          sectionIndex: sectionIndex + 1,
          side: laneSide(succLaneId),
          laneId: succLaneId,
        });
      }
    }
  }

  // Across road boundary: predecessor lane in connected road
  if (sectionIndex === 0 && lane.link?.predecessor != null) {
    const alreadyFoundInSameRoad = predecessors.length > 0;
    if (!alreadyFoundInSameRoad && road.link?.predecessor?.element_type === 'Road') {
      const predRoad = project.roads.find((r) => r.id === road.link!.predecessor!.element_id);
      if (predRoad && predRoad.lane_sections.length > 0) {
        const contactPoint = road.link.predecessor.contact_point;
        const predSectionIndex = contactPoint === 'Start'
          ? 0
          : predRoad.lane_sections.length - 1;
        const predSection = predRoad.lane_sections[predSectionIndex];
        if (predSection) {
          const predLaneId = lane.link.predecessor;
          const predLane = findLaneInSection(predSection, predLaneId);
          if (predLane) {
            predecessors.push({
              type: 'lane',
              roadId: predRoad.id,
              sectionIndex: predSectionIndex,
              side: laneSide(predLaneId),
              laneId: predLaneId,
            });
          }
        }
      }
    }
  }

  // Across road boundary: successor lane in connected road
  const lastIndex = road.lane_sections.length - 1;
  if (sectionIndex === lastIndex && lane.link?.successor != null) {
    const alreadyFoundInSameRoad = successors.length > 0;
    if (!alreadyFoundInSameRoad && road.link?.successor?.element_type === 'Road') {
      const succRoad = project.roads.find((r) => r.id === road.link!.successor!.element_id);
      if (succRoad && succRoad.lane_sections.length > 0) {
        const contactPoint = road.link.successor.contact_point;
        const succSectionIndex = contactPoint === 'Start'
          ? 0
          : succRoad.lane_sections.length - 1;
        const succSection = succRoad.lane_sections[succSectionIndex];
        if (succSection) {
          const succLaneId = lane.link.successor;
          const succLane = findLaneInSection(succSection, succLaneId);
          if (succLane) {
            successors.push({
              type: 'lane',
              roadId: succRoad.id,
              sectionIndex: succSectionIndex,
              side: laneSide(succLaneId),
              laneId: succLaneId,
            });
          }
        }
      }
    }
  }

  return { predecessors, successors };
}
