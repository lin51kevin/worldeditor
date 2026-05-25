import type {
  Junction,
  JunctionConnection,
  JunctionLaneLink,
  Lane,
  LaneSection,
  LinkElement,
  Project,
  Road,
} from '../services/platform';
import { evalRoadAtS } from './roadEdit';

const DEFAULT_LANE_WIDTH = 3.5;
const GAP_EPSILON = 1e-3;

export interface JunctionConnectionDraft {
  id?: string;
  incomingRoad: string;
  connectingRoad: string;
  contactPoint: 'Start' | 'End';
  laneLinks?: JunctionLaneLink[];
}

function isJunctionLink(link: LinkElement | null | undefined, junctionId: string): boolean {
  return link?.element_type === 'Junction' && link.element_id === junctionId;
}

function cloneLane(lane: Lane): Lane {
  return {
    ...lane,
    link: lane.link ? { ...lane.link } : null,
    width: lane.width.map((record) => ({ ...record })),
    borders: lane.borders?.map((record) => ({ ...record })),
    road_marks: lane.road_marks.map((mark) => ({ ...mark })),
  };
}

function makeDefaultDrivingLane(id: number): Lane {
  return {
    id,
    lane_type: 'Driving',
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: DEFAULT_LANE_WIDTH, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function cloneLaneSectionTemplate(section?: LaneSection, laneCount = 1): LaneSection {
  const baseCenter = section?.center.map(cloneLane) ?? [{ id: 0, lane_type: 'none', level: 0, link: null, width: [], road_marks: [] }];
  const rightTemplate = section?.right?.[0] ? cloneLane(section.right[0]) : makeDefaultDrivingLane(-1);
  return {
    s: 0,
    single_side: section?.single_side ?? false,
    left: [],
    center: baseCenter,
    right: Array.from({ length: Math.max(laneCount, 1) }, (_, index) => ({
      ...cloneLane(rightTemplate),
      id: -(index + 1),
      link: null,
    })),
  };
}

function countDrivingRightLanes(road: Road): number {
  const count = road.lane_sections[0]?.right.filter((lane) => String(lane.lane_type).toLowerCase() === 'driving').length ?? 0;
  return Math.max(count, 1);
}

function sanitizeRoadId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function sampleArcLength(
  aU: number,
  bU: number,
  cU: number,
  dU: number,
  aV: number,
  bV: number,
  cV: number,
  dV: number,
  sampleCount = 32,
): number {
  let length = 0;
  let prevU = aU;
  let prevV = aV;

  for (let index = 1; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const t2 = t * t;
    const t3 = t2 * t;
    const u = aU + bU * t + cU * t2 + dU * t3;
    const v = aV + bV * t + cV * t2 + dV * t3;
    length += Math.hypot(u - prevU, v - prevV);
    prevU = u;
    prevV = v;
  }

  return length;
}

function buildHermiteCoefficients(
  start: { x: number; y: number; hdg: number },
  end: { x: number; y: number; hdg: number },
): { aU: number; bU: number; cU: number; dU: number; aV: number; bV: number; cV: number; dV: number; length: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.max(Math.hypot(dx, dy), 1e-3);
  const scale = chord / 3;
  const cosH = Math.cos(start.hdg);
  const sinH = Math.sin(start.hdg);
  const endU = dx * cosH + dy * sinH;
  const endV = -dx * sinH + dy * cosH;
  const t0U = scale;
  const t0V = 0;
  const t1U = (Math.cos(end.hdg) * cosH + Math.sin(end.hdg) * sinH) * chord;
  const t1V = (-Math.cos(end.hdg) * sinH + Math.sin(end.hdg) * cosH) * chord;
  const aU = 0;
  const bU = t0U;
  const cU = 3 * endU - 2 * t0U - t1U;
  const dU = -2 * endU + t0U + t1U;
  const aV = 0;
  const bV = t0V;
  const cV = 3 * endV - 2 * t0V - t1V;
  const dV = -2 * endV + t0V + t1V;

  return {
    aU,
    bU,
    cU,
    dU,
    aV,
    bV,
    cV,
    dV,
    length: Math.max(sampleArcLength(aU, bU, cU, dU, aV, bV, cV, dV), 0.1),
  };
}

function getJunctionFromProject(project: Project, junctionId: string): Junction | undefined {
  return project.junctions.find((junction) => junction.id === junctionId);
}

export function isRoadLinkedToJunction(road: Road, junctionId: string): boolean {
  return isJunctionLink(road.link?.predecessor, junctionId) || isJunctionLink(road.link?.successor, junctionId);
}

export function getRoadJunctionContactPoint(road: Road, junctionId: string): 'Start' | 'End' | null {
  if (isJunctionLink(road.link?.predecessor, junctionId)) {
    return 'Start';
  }
  if (isJunctionLink(road.link?.successor, junctionId)) {
    return 'End';
  }
  return null;
}

export function getJunctionIncomingRoads(project: Project, junctionId: string): Road[] {
  const junction = getJunctionFromProject(project, junctionId);
  const incomingIds = new Set(junction?.connections.map((connection) => connection.incoming_road) ?? []);
  project.roads.forEach((road) => {
    if (isJunctionLink(road.link?.successor, junctionId)) {
      incomingIds.add(road.id);
    }
  });
  return project.roads.filter((road) => incomingIds.has(road.id) && road.junction_id !== junctionId);
}

export function getJunctionOutgoingRoads(project: Project, junctionId: string): Road[] {
  const junction = getJunctionFromProject(project, junctionId);
  const outgoingIds = new Set<string>();
  project.roads.forEach((road) => {
    if (isJunctionLink(road.link?.predecessor, junctionId)) {
      outgoingIds.add(road.id);
    }
  });
  junction?.connections.forEach((connection) => {
    const outgoingRoadId = getConnectionOutgoingRoadId(project, connection);
    if (outgoingRoadId) {
      outgoingIds.add(outgoingRoadId);
    }
  });
  return project.roads.filter((road) => outgoingIds.has(road.id) && road.junction_id !== junctionId);
}

export function getJunctionConnectingRoads(project: Project, junctionId: string): Road[] {
  const junction = getJunctionFromProject(project, junctionId);
  const connectingIds = new Set(junction?.connections.map((connection) => connection.connecting_road) ?? []);
  project.roads.forEach((road) => {
    if (road.junction_id === junctionId) {
      connectingIds.add(road.id);
    }
  });
  return project.roads.filter((road) => connectingIds.has(road.id));
}

export function getConnectionOutgoingRoadId(project: Project, connection: JunctionConnection): string | null {
  const connectingRoad = project.roads.find((road) => road.id === connection.connecting_road);
  if (!connectingRoad?.link) {
    return null;
  }

  const candidates = [connectingRoad.link.predecessor, connectingRoad.link.successor]
    .filter((link): link is LinkElement => Boolean(link))
    .filter((link) => link.element_type === 'Road' && link.element_id !== connection.incoming_road);

  return candidates[0]?.element_id ?? null;
}

export function computeJunctionCenter(project: Project, junctionId: string): { x: number; y: number } | null {
  const samples: Array<{ x: number; y: number }> = [];

  project.roads.forEach((road) => {
    const contactPoint = getRoadJunctionContactPoint(road, junctionId);
    if (contactPoint) {
      const pose = evalRoadAtS(road, contactPoint === 'Start' ? 0 : road.length);
      samples.push({ x: pose.x, y: pose.y });
    }
  });

  if (samples.length === 0) {
    return null;
  }

  const sum = samples.reduce((acc, sample) => ({ x: acc.x + sample.x, y: acc.y + sample.y }), { x: 0, y: 0 });
  return { x: sum.x / samples.length, y: sum.y / samples.length };
}

export function chooseRoadConnectionContactPoint(project: Project, junctionId: string, road: Road): 'Start' | 'End' {
  const junctionCenter = computeJunctionCenter(project, junctionId);
  if (!junctionCenter) {
    return 'End';
  }

  const startPose = evalRoadAtS(road, 0);
  const endPose = evalRoadAtS(road, road.length);
  const startDistance = Math.hypot(startPose.x - junctionCenter.x, startPose.y - junctionCenter.y);
  const endDistance = Math.hypot(endPose.x - junctionCenter.x, endPose.y - junctionCenter.y);
  return startDistance <= endDistance ? 'Start' : 'End';
}

export function createConnectorRoadId(junctionId: string, incomingRoadId: string, outgoingRoadId: string): string {
  return `${junctionId}_${sanitizeRoadId(incomingRoadId)}_${sanitizeRoadId(outgoingRoadId)}`;
}

export function createJunctionConnectionId(junction: Junction): string {
  const existingIds = new Set(junction.connections.map((connection) => connection.id));
  let index = junction.connections.length;
  let nextId = `conn_${index}`;
  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `conn_${index}`;
  }
  return nextId;
}

export function buildConnectorRoad(
  project: Project,
  junctionId: string,
  incomingRoadId: string,
  outgoingRoadId: string,
  roadId = createConnectorRoadId(junctionId, incomingRoadId, outgoingRoadId),
): Road | null {
  const incomingRoad = project.roads.find((road) => road.id === incomingRoadId);
  const outgoingRoad = project.roads.find((road) => road.id === outgoingRoadId);

  if (!incomingRoad || !outgoingRoad || incomingRoad.id === outgoingRoad.id) {
    return null;
  }

  const start = evalRoadAtS(incomingRoad, incomingRoad.length);
  const end = evalRoadAtS(outgoingRoad, 0);
  const coeffs = buildHermiteCoefficients(start, end);
  const laneCount = Math.max(1, Math.min(countDrivingRightLanes(incomingRoad), countDrivingRightLanes(outgoingRoad)));
  const laneSectionTemplate = incomingRoad.lane_sections[0] ?? outgoingRoad.lane_sections[0];

  return {
    id: roadId,
    name: `${incomingRoad.name || incomingRoad.id} → ${outgoingRoad.name || outgoingRoad.id}`,
    length: coeffs.length,
    junction_id: junctionId,
    link: {
      predecessor: { element_id: incomingRoadId, element_type: 'Road', contact_point: 'End' },
      successor: { element_id: outgoingRoadId, element_type: 'Road', contact_point: 'Start' },
    },
    plan_view: [{
      s: 0,
      x: start.x,
      y: start.y,
      hdg: start.hdg,
      length: coeffs.length,
      geo_type: {
        ParamPoly3: {
          a_u: coeffs.aU,
          b_u: coeffs.bU,
          c_u: coeffs.cU,
          d_u: coeffs.dU,
          a_v: coeffs.aV,
          b_v: coeffs.bV,
          c_v: coeffs.cV,
          d_v: coeffs.dV,
          p_range: 'Normalized',
        },
      },
    }],
    elevation_profile: [],
    lane_sections: [cloneLaneSectionTemplate(laneSectionTemplate, laneCount)],
  };
}

export function attachRoadToJunction(
  project: Project,
  junctionId: string,
  roadId: string,
  contactPoint: 'Start' | 'End',
): Project {
  return {
    ...project,
    roads: project.roads.map((road) => {
      if (road.id !== roadId) {
        return road;
      }
      return {
        ...road,
        junction_id: road.junction_id === junctionId ? null : road.junction_id,
        link: {
          predecessor: contactPoint === 'Start'
            ? { element_id: junctionId, element_type: 'Junction', contact_point: 'Start' }
            : road.link?.predecessor ?? null,
          successor: contactPoint === 'End'
            ? { element_id: junctionId, element_type: 'Junction', contact_point: 'End' }
            : road.link?.successor ?? null,
        },
      };
    }),
  };
}

export function addJunctionConnectionToProject(
  project: Project,
  junctionId: string,
  connection: JunctionConnectionDraft,
): Project {
  return {
    ...project,
    junctions: project.junctions.map((junction) => {
      if (junction.id !== junctionId) {
        return junction;
      }

      const exists = junction.connections.some((existing) =>
        existing.incoming_road === connection.incomingRoad
        && existing.connecting_road === connection.connectingRoad,
      );
      if (exists) {
        return junction;
      }

      return {
        ...junction,
        connections: [...junction.connections, {
          id: connection.id ?? createJunctionConnectionId(junction),
          incoming_road: connection.incomingRoad,
          connecting_road: connection.connectingRoad,
          contact_point: connection.contactPoint,
          lane_links: connection.laneLinks?.map((laneLink) => ({ ...laneLink })) ?? [],
        }],
      };
    }),
  };
}

export function removeJunctionConnectionFromProject(
  project: Project,
  junctionId: string,
  connectionIndex: number,
): Project {
  const junction = getJunctionFromProject(project, junctionId);
  const connection = junction?.connections[connectionIndex];
  if (!junction || !connection) {
    return project;
  }

  const nextConnections = junction.connections.filter((_, index) => index !== connectionIndex);
  const stillReferenced = nextConnections.some((entry) => entry.connecting_road === connection.connecting_road);
  const shouldRemoveConnector = !stillReferenced;

  return {
    ...project,
    roads: shouldRemoveConnector
      ? project.roads.filter((road) => road.id !== connection.connecting_road)
      : project.roads,
    junctions: project.junctions.map((entry) => (
      entry.id === junctionId ? { ...entry, connections: nextConnections } : entry
    )),
  };
}

export function addConnectionBetweenRoads(
  project: Project,
  junctionId: string,
  incomingRoadId: string,
  outgoingRoadId: string,
): Project {
  const junction = getJunctionFromProject(project, junctionId);
  if (!junction) {
    return project;
  }

  const duplicate = junction.connections.some((connection) => (
    connection.incoming_road === incomingRoadId
    && getConnectionOutgoingRoadId(project, connection) === outgoingRoadId
  ));
  if (duplicate) {
    return project;
  }

  let nextProject = project;
  const incomingRoad = project.roads.find((road) => road.id === incomingRoadId);
  const outgoingRoad = project.roads.find((road) => road.id === outgoingRoadId);
  if (!incomingRoad || !outgoingRoad) {
    return project;
  }

  if (!isJunctionLink(incomingRoad.link?.successor, junctionId)) {
    nextProject = attachRoadToJunction(nextProject, junctionId, incomingRoadId, 'End');
  }
  if (!isJunctionLink(outgoingRoad.link?.predecessor, junctionId)) {
    nextProject = attachRoadToJunction(nextProject, junctionId, outgoingRoadId, 'Start');
  }

  const connectorRoad = buildConnectorRoad(nextProject, junctionId, incomingRoadId, outgoingRoadId);
  if (!connectorRoad) {
    return project;
  }

  const laneLinks: JunctionLaneLink[] = connectorRoad.lane_sections[0]?.right.map((lane) => ({ from: lane.id, to: lane.id })) ?? [];
  const withRoad = nextProject.roads.some((road) => road.id === connectorRoad.id)
    ? nextProject
    : { ...nextProject, roads: [...nextProject.roads, connectorRoad] };

  return addJunctionConnectionToProject(withRoad, junctionId, {
    incomingRoad: incomingRoadId,
    connectingRoad: connectorRoad.id,
    contactPoint: 'Start',
    laneLinks,
  });
}

export function detachRoadFromJunction(project: Project, junctionId: string, roadId: string): Project {
  const junction = getJunctionFromProject(project, junctionId);
  if (!junction) {
    return project;
  }

  const removableConnectionIndices = junction.connections
    .map((connection, index) => ({ connection, index }))
    .filter(({ connection }) => (
      connection.incoming_road === roadId
      || connection.connecting_road === roadId
      || getConnectionOutgoingRoadId(project, connection) === roadId
    ))
    .map(({ index }) => index)
    .sort((left, right) => right - left);

  let nextProject = project;
  removableConnectionIndices.forEach((index) => {
    nextProject = removeJunctionConnectionFromProject(nextProject, junctionId, index);
  });

  return {
    ...nextProject,
    roads: nextProject.roads.map((road) => {
      if (road.id !== roadId) {
        return road;
      }
      return {
        ...road,
        junction_id: road.junction_id === junctionId ? null : road.junction_id,
        link: {
          predecessor: isJunctionLink(road.link?.predecessor, junctionId) ? null : road.link?.predecessor ?? null,
          successor: isJunctionLink(road.link?.successor, junctionId) ? null : road.link?.successor ?? null,
        },
      };
    }),
  };
}

export function fillJunctionConnectionGaps(project: Project, junctionId: string): Project {
  const junction = getJunctionFromProject(project, junctionId);
  if (!junction || junction.connections.length === 0) {
    return project;
  }

  let changed = false;
  const roads = project.roads.map((road) => {
    const connection = junction.connections.find((entry) => entry.connecting_road === road.id);
    if (!connection) {
      return road;
    }

    const outgoingRoadId = getConnectionOutgoingRoadId(project, connection);
    if (!outgoingRoadId) {
      return road;
    }

    const rebuiltRoad = buildConnectorRoad(project, junctionId, connection.incoming_road, outgoingRoadId, road.id);
    if (!rebuiltRoad) {
      return road;
    }

    const startPose = evalRoadAtS(road, 0);
    const rebuiltStartPose = evalRoadAtS(rebuiltRoad, 0);
    const endPose = evalRoadAtS(road, road.length);
    const rebuiltEndPose = evalRoadAtS(rebuiltRoad, rebuiltRoad.length);
    if (
      Math.hypot(startPose.x - rebuiltStartPose.x, startPose.y - rebuiltStartPose.y) > GAP_EPSILON
      || Math.hypot(endPose.x - rebuiltEndPose.x, endPose.y - rebuiltEndPose.y) > GAP_EPSILON
      || Math.abs(road.length - rebuiltRoad.length) > GAP_EPSILON
    ) {
      changed = true;
      return rebuiltRoad;
    }

    return road;
  });

  return changed ? { ...project, roads } : project;
}
