/**
 * Roundabout junction builder.
 *
 * Builds the multi-junction roundabout topology (ring arcs + arm roads +
 * per-junction connector roads) from a junction template config. Matches the
 * C# reference implementation.
 */
import type {
  Road, Geometry, Junction, JunctionConnection, LinkElement,
} from '../../../services/platform';
import type { JunctionTemplateConfig } from './schema';
import { addTurnArrows, addCrosswalks } from './decorators';
import { genId, buildRoad, buildLaneSection, buildLaneSectionFromConfig } from './engine';
import { roadEndPoint, buildHermiteConnectorGeometry, type JunctionBuildResult } from './junctionEngine';

const DEFAULT_LANE_WIDTH = 3.5;

function arcGeometry(x: number, y: number, hdg: number, length: number, curvature: number): Geometry {
  return { s: 0, x, y, hdg, length, geo_type: { Arc: { curvature } } };
}

const DEFAULT_ROUNDABOUT_RADIUS = 50;
const DEFAULT_ROAD_TO_CENTER = 20;

/** Result for roundabout: multiple junctions. */
export interface RoundaboutBuildResult {
  junctions: Junction[];
  roads: Road[];
}

/**
 * Build a roundabout with multi-junction topology (matching C# reference).
 *
 * Architecture (matching C# BuildJunctionRoundabout):
 *   - N junctions (one at each arm-ring intersection point)
 *   - N ring arc roads (partial arcs with gaps between them at junction locations)
 *   - N arm roads approaching each junction from outside
 *   - Connector roads within each junction bridging arm↔ring traffic
 *
 * C# key parameters:
 *   radius = 50 (ring center radius)
 *   roadToCenter = 20 (gap between ring edge and arm road end)
 *   oneSegmentDegree = 240/N (arc span per segment)
 *   ratio = 0.5 (controls gap size between arcs)
 *   startDegree = 90 - oneSegmentDegree/2
 *
 * Ring arc[i]:
 *   Starts at startDegree + i*(1+ratio)*oneSegmentDegree
 *   Spans oneSegmentDegree degrees (NOT full angle between arms)
 *   predecessor=junction[i], successor=junction[(i+1)%N]
 *
 * Arm[i]:
 *   At angle = startDegree + (1+0.5*ratio)*oneSegmentDegree + i*(1+ratio)*oneSegmentDegree
 *   Points inward, successor=junction[i]
 */
export function buildRoundaboutFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  const n = config.armCount ?? 3;
  const radius = config.roundaboutRadius ?? DEFAULT_ROUNDABOUT_RADIUS;
  const roadToCenter = DEFAULT_ROAD_TO_CENTER;
  const armLength = config.armLength;
  const W = DEFAULT_LANE_WIDTH; // 3.5
  const SW = 2.0; // shoulder width matching C# reference

  // ── C# angle calculations ─────────────────────────────────────────────────
  const oneSegmentDeg = 240.0 / n;
  const startDeg = 90.0 - oneSegmentDeg / 2;
  const ratio = 0.5;
  const deg2rad = Math.PI / 180;

  // Compute arc start/end angles and arm angles (in degrees)
  const arcStartAngles: number[] = [];
  const arcEndAngles: number[] = [];
  const armAnglesDeg: number[] = [];
  for (let i = 0; i < n; i++) {
    const arcStart = startDeg + i * (1 + ratio) * oneSegmentDeg;
    arcStartAngles.push(arcStart);
    arcEndAngles.push(arcStart + oneSegmentDeg);
    armAnglesDeg.push(startDeg + (1 + 0.5 * ratio) * oneSegmentDeg + i * (1 + ratio) * oneSegmentDeg);
  }

  // ── Ring lane section (matching C# reference) ─────────────────────────────
  // left=[shoulder w=2], right=[driving w=3.5, driving w=3.5, shoulder w=2]
  const ringSection = buildLaneSection(
    [{ laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } }],
    [
      { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
      { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
      { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
    ],
  );

  // ── Arm lane section (matching C# reference) ──────────────────────────────
  // left=[driving w=3.5, shoulder w=2], right=[driving w=3.5, shoulder w=2]
  const armSection = buildLaneSectionFromConfig(
    config.armSection ?? {
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
    },
  );

  // ── Create N junctions ────────────────────────────────────────────────────
  const junctionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    junctionIds.push(genId());
  }

  // ── Ring arc roads (partial arcs with gaps at junctions) ──────────────────
  // arc[i] starts at arcStartAngles[i], spans oneSegmentDeg degrees
  // Junction[i] sits at the gap between arc[i].End and arc[(i+1)%n].Start
  // So: arc[i].predecessor = junction[(i-1+n)%n] (where it starts from)
  //     arc[i].successor = junction[i] (where it ends at)
  const arcRoads: Road[] = [];
  for (let i = 0; i < n; i++) {
    const prevJunctionIdx = (i - 1 + n) % n;
    const arcStartRad = arcStartAngles[i]! * deg2rad;
    const arcSpanRad = oneSegmentDeg * deg2rad;
    const arcLen = radius * arcSpanRad;

    // Start point on ring circle
    const sx = cx + radius * Math.cos(arcStartRad);
    const sy = cy + radius * Math.sin(arcStartRad);
    // Tangent: perpendicular to radius, CCW direction (angle + π/2)
    const hdg = arcStartRad + Math.PI / 2;
    const curvature = 1 / radius; // CCW = positive curvature

    const arcRoad = buildRoad(ringSection, {
      x: sx,
      y: sy,
      hdg,
      length: arcLen,
      junctionId: null,
      link: {
        predecessor: { element_type: 'Junction', element_id: junctionIds[prevJunctionIdx]!, contact_point: null },
        successor: { element_type: 'Junction', element_id: junctionIds[i]!, contact_point: null },
      },
    });
    arcRoad.plan_view = [arcGeometry(sx, sy, hdg, arcLen, curvature)];
    arcRoads.push(arcRoad);
  }

  // ── Arm roads (radiate outward, point inward toward junction) ──────────────
  const armRoads: Road[] = [];
  for (let i = 0; i < n; i++) {
    const armAngleRad = armAnglesDeg[i]! * deg2rad;
    // Arm tip (start point) is at outer edge
    const tipDist = radius + roadToCenter + armLength;
    const tipX = cx + tipDist * Math.cos(armAngleRad);
    const tipY = cy + tipDist * Math.sin(armAngleRad);
    // Inward heading (toward center)
    const inwardHdg = armAngleRad + Math.PI;

    const junctionLink: LinkElement = {
      element_type: 'Junction',
      element_id: junctionIds[i]!,
      contact_point: null,
    };

    const armRoad = buildRoad(armSection, {
      x: tipX,
      y: tipY,
      hdg: inwardHdg,
      length: armLength,
      junctionId: null,
      link: { predecessor: null, successor: junctionLink },
    });
    armRoads.push(armRoad);
  }

  // ── Build connector roads and connections per junction ─────────────────────
  // At junction[i] (in the gap between arc[i].End and arc[(i+1)%n].Start):
  //   - arc[i] END (ring arc arriving from CCW direction)
  //   - arc[(i+1)%n] START (ring arc departing in CCW direction)
  //   - arm[i] END (arm road arriving from outside)
  //
  // C# connector groups (6 per junction):
  //   result0: arc[i].Right.End → arc[(i+1)%n].Right.Start (ring pass-through)
  //   result1: arc[(i+1)%n].Left.Start → arc[i].Left.End (reverse shoulder)
  //   result2: arc[i].Right.End → arm[i].Left.End (ring exit to arm)
  //   result3: arm[i].Right.End → arc[(i+1)%n].Right.Start (arm entry to ring)
  //   result4: arm[i].Right.End → arc[i].Left.End (U-turn into ring behind)
  //   result5: arc[(i+1)%n].Left.Start → arm[i].Left.End (ring forward exit to arm)

  // Helper: offset a point to the RIGHT by 'dist' (perpendicular to heading)
  const offsetPoint = (pt: { x: number; y: number; hdg: number }, dist: number) => ({
    x: pt.x + Math.sin(pt.hdg) * dist,
    y: pt.y - Math.cos(pt.hdg) * dist,
  });

  const junctions: Junction[] = [];
  const connectorRoads: Road[] = [];

  for (let i = 0; i < n; i++) {
    const connections: JunctionConnection[] = [];
    const arrivingArcIdx = i;            // arc[i] ends at this junction
    const departingArcIdx = (i + 1) % n; // arc[(i+1)%n] starts from this junction

    // Compute key positions
    const arcArriveEnd = arcEndPoint(arcRoads[arrivingArcIdx]!);
    const arcDepartStart = arcStartPoint(arcRoads[departingArcIdx]!);
    const armEnd = roadEndPoint(armRoads[i]!);

    // result0: ring pass-through (arc[i].Right.End → arc[(i+1)%n].Right.Start)
    // Only driving lanes pass through the ring; shoulder connects via arm entry/exit
    const ringPassLanes = [
      { laneId: -1, offset: 0, cfg: { laneType: 'Driving' as const, width: W } },
      { laneId: -2, offset: W, cfg: { laneType: 'Driving' as const, width: W } },
    ];
    for (const { laneId, offset, cfg } of ringPassLanes) {
      const startPt = offsetPoint(arcArriveEnd, offset);
      const endPt = offsetPoint(arcDepartStart, offset);
      const connector = buildRoundaboutConnector(
        startPt.x, startPt.y, arcArriveEnd.hdg,
        endPt.x, endPt.y, arcDepartStart.hdg,
        cfg,
        junctionIds[i]!,
        arcRoads[arrivingArcIdx]!.id, arcRoads[departingArcIdx]!.id,
        'End', 'Start',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: arcRoads[arrivingArcIdx]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: laneId, to: -1 }],
      });
    }

    // result1: reverse shoulder pass-through (arc[(i+1)%n].Left.Start → arc[i].Left.End)
    // Left lane +1 is on the left side of the reference line (offset = 0 from ref in left direction)
    const connector1 = buildRoundaboutConnector(
      arcDepartStart.x, arcDepartStart.y, arcDepartStart.hdg + Math.PI,
      arcArriveEnd.x, arcArriveEnd.y, arcArriveEnd.hdg + Math.PI,
      { laneType: 'Shoulder', width: SW },
      junctionIds[i]!,
      arcRoads[departingArcIdx]!.id, arcRoads[arrivingArcIdx]!.id,
      'Start', 'End',
    );
    connectorRoads.push(connector1);
    connections.push({
      id: genId(),
      incoming_road: arcRoads[departingArcIdx]!.id,
      connecting_road: connector1.id,
      contact_point: 'Start',
      lane_links: [{ from: 1, to: -1 }],
    });

    // result2: ring exit to arm (arc[i] outer driving → arm[i] left side)
    // Only 1 connector: ring's outer driving lane (-2, next to shoulder) exits to arm's left driving lane
    const armExitHdg = armEnd.hdg + Math.PI; // outbound direction on arm
    {
      const startPt = offsetPoint(arcArriveEnd, W); // ring lane -2 (outer driving, offset=W from ref)
      const endPt = offsetPoint({ ...armEnd, hdg: armExitHdg }, 0); // arm left lane +1
      const connector = buildRoundaboutConnector(
        startPt.x, startPt.y, arcArriveEnd.hdg,
        endPt.x, endPt.y, armExitHdg,
        { laneType: 'Driving', width: W },
        junctionIds[i]!,
        arcRoads[arrivingArcIdx]!.id, armRoads[i]!.id,
        'End', 'End',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: arcRoads[arrivingArcIdx]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -2, to: -1 }],
      });
    }

    // result3: arm entry to ring (arm[i] right driving → arc[(i+1)%n] outer driving)
    // Only 1 connector: arm's right driving lane (-1) enters ring's outer driving lane (-2, next to shoulder)
    {
      const startPt = offsetPoint(armEnd, 0); // arm lane -1 (right driving, offset=0)
      const endPt = offsetPoint(arcDepartStart, W); // ring lane -2 (outer driving, offset=W)
      const connector = buildRoundaboutConnector(
        startPt.x, startPt.y, armEnd.hdg,
        endPt.x, endPt.y, arcDepartStart.hdg,
        { laneType: 'Driving', width: W },
        junctionIds[i]!,
        armRoads[i]!.id, arcRoads[departingArcIdx]!.id,
        'End', 'Start',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: armRoads[i]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -1, to: -1 }],
      });
    }

    // result4: shoulder exit (ring shoulder -3 → arm left shoulder +2)
    {
      const startPt = offsetPoint(arcArriveEnd, 2 * W); // ring lane -3 (shoulder, offset=2W)
      const endPt = offsetPoint({ ...armEnd, hdg: armExitHdg }, W); // arm left shoulder +2 (offset=W from exit hdg)
      const connector = buildRoundaboutConnector(
        startPt.x, startPt.y, arcArriveEnd.hdg,
        endPt.x, endPt.y, armExitHdg,
        { laneType: 'Shoulder', width: SW },
        junctionIds[i]!,
        arcRoads[arrivingArcIdx]!.id, armRoads[i]!.id,
        'End', 'End',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: arcRoads[arrivingArcIdx]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -3, to: -1 }],
      });
    }

    // result5: shoulder entry (arm right shoulder -2 → ring shoulder -3)
    {
      const startPt = offsetPoint(armEnd, W); // arm lane -2 (shoulder, offset=W)
      const endPt = offsetPoint(arcDepartStart, 2 * W); // ring lane -3 (shoulder, offset=2W)
      const connector = buildRoundaboutConnector(
        startPt.x, startPt.y, armEnd.hdg,
        endPt.x, endPt.y, arcDepartStart.hdg,
        { laneType: 'Shoulder', width: SW },
        junctionIds[i]!,
        armRoads[i]!.id, arcRoads[departingArcIdx]!.id,
        'End', 'Start',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: armRoads[i]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -2, to: -1 }],
      });
    }

    junctions.push({
      id: junctionIds[i]!,
      name: config.name ? `${config.name} (${i + 1})` : '',
      connections,
    });
  }

  // ── Post-processing: add stop lines, crosswalks, arrows ───────────────────
  const section = config.armSection ?? {
    left: [
      { laneType: 'Driving', width: W },
      { laneType: 'Shoulder', width: SW },
    ],
    right: [
      { laneType: 'Driving', width: W },
      { laneType: 'Shoulder', width: SW },
    ],
  };
  const roadWidth = section.right.reduce((sum, l) => sum + (l.width ?? W), 0);
  for (const arm of armRoads) {
    if (!arm.objects) arm.objects = [];
    arm.objects.push({
      id: genId(),
      object_type: 'StopLine',
      name: 'stop_line',
      position: { x: arm.length - 0.1, y: 0, z: 0.01, id: null },
      orientation: 0,
      hdg: 0,
      width: roadWidth,
      height: 0.01,
      length: 0.3,
      corners: [],
      validity: null,
    });
  }
  addCrosswalks(armRoads);
  addTurnArrows(armRoads, n);

  return { junction: junctions[0]!, roads: [...arcRoads, ...armRoads, ...connectorRoads], extraJunctions: junctions.slice(1) };
}

/**
 * Compute the end point of an arc road (where it reaches the next junction).
 */
function arcEndPoint(arcRoad: Road): { x: number; y: number; hdg: number } {
  const geo = arcRoad.plan_view[0]!;
  if (typeof geo.geo_type === 'object' && 'Arc' in geo.geo_type) {
    const curvature = geo.geo_type.Arc.curvature;
    if (Math.abs(curvature) > 1e-10) {
      const r = 1 / curvature;
      const arcAngle = arcRoad.length * curvature;
      const endHdg = geo.hdg + arcAngle;
      const cx2 = geo.x - r * Math.sin(geo.hdg);
      const cy2 = geo.y + r * Math.cos(geo.hdg);
      return {
        x: cx2 + r * Math.sin(endHdg),
        y: cy2 - r * Math.cos(endHdg),
        hdg: endHdg,
      };
    }
  }
  // Fallback: straight line
  return {
    x: geo.x + Math.cos(geo.hdg) * arcRoad.length,
    y: geo.y + Math.sin(geo.hdg) * arcRoad.length,
    hdg: geo.hdg,
  };
}

/**
 * Compute the start point of an arc road (where it begins at the junction).
 */
function arcStartPoint(arcRoad: Road): { x: number; y: number; hdg: number } {
  const geo = arcRoad.plan_view[0]!;
  return { x: geo.x, y: geo.y, hdg: geo.hdg };
}

/**
 * Build a single-lane connector for roundabout junctions.
 * Uses Hermite paramPoly3 geometry (matching C# reference).
 */
function buildRoundaboutConnector(
  startX: number, startY: number, startHdg: number,
  endX: number, endY: number, endHdg: number,
  laneCfg: { laneType: string; width: number },
  junctionId: string,
  predRoadId: string,
  succRoadId: string,
  predContactPoint: 'Start' | 'End' = 'End',
  succContactPoint: 'Start' | 'End' = 'Start',
): Road {
  const connectorSection = buildLaneSection([], [laneCfg]);
  const geometries = buildHermiteConnectorGeometry(startX, startY, startHdg, endX, endY, endHdg);
  const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);

  const road = buildRoad(connectorSection, {
    x: startX,
    y: startY,
    hdg: startHdg,
    length: totalLength,
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: predRoadId, contact_point: predContactPoint },
      successor: { element_type: 'Road', element_id: succRoadId, contact_point: succContactPoint },
    },
  });
  road.plan_view = geometries;
  return road;
}
