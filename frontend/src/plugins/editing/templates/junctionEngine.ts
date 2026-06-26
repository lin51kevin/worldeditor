/**
 * Junction template engine.
 *
 * Builds junction domain objects (T / Cross / Radial / Roundabout topologies)
 * from declarative junction template configs. Pure functions — callers are
 * responsible for dispatching results to stores.
 *
 * Shared road/lane/section primitives live in `engine.ts`.
 */
import type {
  Road, Geometry, Junction, JunctionConnection, LinkElement,
} from '../../../services/platform';
import type {
  LaneConfig, SectionConfig,
  JunctionTemplateConfig, JunctionTopology,
} from './schema';
import { addTurnArrows, addCrosswalks, solidateBrokenLinesNearJunction } from './decorators';
import { genId, buildRoad, buildLaneSection, buildLaneSectionFromConfig } from './engine';
import { buildRoundaboutFromConfig } from './roundabout';

const DEFAULT_LANE_WIDTH = 3.5;

// ── Junction arm geometry helpers ────────────────────────────────────────────

interface ArmDef {
  x: number;
  y: number;
  hdg: number;
}

/** Default arm section: 2 driving + 1 shoulder per side, matching C# reference. */
const DEFAULT_ARM_SECTION: SectionConfig = {
  left: [
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Shoulder', width: 2.0, mark: { type: 'None' } },
  ],
  right: [
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Shoulder', width: 2.0, mark: { type: 'None' } },
  ],
};

/**
 * Compute the gap distance from junction center to arm road endpoints.
 *
 * Uses armLength/2 as the standard gap (matching C# reference which uses gap=50
 * for armLength=100 uniformly for all arm counts). A minimum overlap-prevention
 * check ensures very wide roads or high arm counts don't cause overlap.
 */
function computeArmGap(section: SectionConfig, armCount: number, armLength: number): number {
  const totalWidth = [...section.left, ...section.right]
    .reduce((sum, lane) => sum + (lane.width ?? DEFAULT_LANE_WIDTH), 0);
  const n = Math.max(armCount, 3);
  const angularFactor = 1 / Math.sin(Math.PI / n);
  // Minimum gap to prevent adjacent arm edges from overlapping
  const minForNonOverlap = totalWidth * angularFactor * 1.0;
  // C# uses armLength/2 as standard gap (50m for 100m arms)
  const standardGap = armLength * 0.5;
  return Math.max(minForNonOverlap, standardGap);
}

function radialArms(cx: number, cy: number, gap: number, count: number): ArmDef[] {
  const arms: ArmDef[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count;
    arms.push({
      x: cx + gap * Math.cos(angle),
      y: cy + gap * Math.sin(angle),
      hdg: angle,
    });
  }
  return arms;
}

function tArms(cx: number, cy: number, gap: number): ArmDef[] {
  // Classic T-shape: stem at 0° (east), arms at 90° (north) and -90° (south)
  const angles = [0, Math.PI / 2, -Math.PI / 2];
  return angles.map(angle => ({
    x: cx + gap * Math.cos(angle),
    y: cy + gap * Math.sin(angle),
    hdg: angle,
  }));
}

function resolveArms(topology: JunctionTopology, cx: number, cy: number, gap: number, armCount?: number): ArmDef[] {
  switch (topology) {
    case 'T': return tArms(cx, cy, gap);
    case 'Cross': return radialArms(cx, cy, gap, 4);
    case 'Radial':
      return radialArms(cx, cy, gap, armCount ?? 4);
    case 'Roundabout':
      return radialArms(cx, cy, gap, armCount ?? 4);
  }
}

/** Resolve the arm count for a given topology. */
function resolveArmCount(topology: JunctionTopology, armCount?: number): number {
  switch (topology) {
    case 'T': return 3;
    case 'Cross': return 4;
    case 'Radial': return armCount ?? 4;
    case 'Roundabout': return armCount ?? 4;
  }
}

// ── Connector road builder ───────────────────────────────────────────────────

/**
 * Compute the end point of a road (junction edge for inward-pointing arm roads).
 */
export function roadEndPoint(road: Road): { x: number; y: number; hdg: number } {
  const geo = road.plan_view[0]!;
  return {
    x: geo.x + Math.cos(geo.hdg) * road.length,
    y: geo.y + Math.sin(geo.hdg) * road.length,
    hdg: geo.hdg,
  };
}

/**
 * Build a single-lane connector road between two arm roads (matching C# per-lane pattern).
 *
 * Each connector carries exactly ONE lane. The connector reference line is offset
 * laterally from the arm road's end to align with the inner edge of the target lane.
 *
 * @param armA - Source arm road (incoming traffic)
 * @param armB - Target arm road (outgoing traffic)
 * @param junctionId - Junction ID
 * @param laneCfg - Lane type/width for this connector
 * @param laneIdx - 0-based index of the lane (0=innermost, counting outward)
 * @param allLanes - All right-side lanes (for computing cumulative offset)
 */
function buildSingleLaneConnector(
  armA: Road,
  armB: Road,
  junctionId: string,
  laneCfg: LaneConfig,
  laneIdx: number,
  allLanes: LaneConfig[],
): Road {
  const endA = roadEndPoint(armA);
  const endB = roadEndPoint(armB);

  // Compute lateral offset: cumulative width of all lanes inside this one
  let cumulativeOffset = 0;
  for (let k = 0; k < laneIdx; k++) {
    cumulativeOffset += allLanes[k]!.width ?? DEFAULT_LANE_WIDTH;
  }

  // Offset direction: perpendicular right from road heading = (sin(hdg), -cos(hdg))
  const offsetAx = Math.sin(endA.hdg) * cumulativeOffset;
  const offsetAy = -Math.cos(endA.hdg) * cumulativeOffset;

  // For target arm: the connector arrives at armB's left-side lane (positive IDs).
  // The target lane index mirrors the source. Offset from armB end is the same amount
  // but in the perpendicular-left direction of armB's heading (since it enters from the left).
  // ArmB heading + π = departure direction. Perpendicular right of departure = perpendicular left of armB.
  const departureHdg = endB.hdg + Math.PI;
  const offsetBx = Math.sin(departureHdg) * cumulativeOffset;
  const offsetBy = -Math.cos(departureHdg) * cumulativeOffset;

  // Connector start/end with lateral offsets
  const startX = endA.x + offsetAx;
  const startY = endA.y + offsetAy;
  const endX = endB.x + offsetBx;
  const endY = endB.y + offsetBy;

  // Build single-lane section
  const connectorSection = buildLaneSection([], [laneCfg]);

  // Arrival direction: traffic flows along armA's heading
  const arrivalHdg = endA.hdg;

  // Generate paramPoly3 geometry segments for smooth S-curve
  const geometries = buildHermiteConnectorGeometry(
    startX, startY, arrivalHdg,
    endX, endY, departureHdg,
  );

  const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);

  // Lane link in road: connector's lane -1 links to source lane and target lane
  const sourceLaneId = -(laneIdx + 1); // e.g., -1, -2, -3
  const targetLaneId = laneIdx + 1;     // e.g., 1, 2, 3 (left-side of target arm)

  const road = buildRoad(connectorSection, {
    x: startX,
    y: startY,
    hdg: arrivalHdg,
    length: totalLength,
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: armA.id, contact_point: 'End' },
      successor: { element_type: 'Road', element_id: armB.id, contact_point: 'End' },
    },
  });

  // Store lane links inside the lane section for OpenDRIVE compatibility
  const connLane = road.lane_sections[0]?.right[0];
  if (connLane) {
    connLane.link = {
      predecessor: sourceLaneId,
      successor: targetLaneId,
    };
  }

  road.plan_view = geometries;
  return road;
}

/**
 * Build Hermite-interpolated paramPoly3 geometry for a connector road.
 * Splits the curve into 3 segments for better approximation (matching C# reference).
 *
 * Uses cubic Hermite interpolation in local (u,v) frame:
 *   u(t) = au + bu*t + cu*t² + du*t³
 *   v(t) = av + bv*t + cv*t² + dv*t³
 * where t ∈ [0,1] (normalized pRange).
 */
export function buildHermiteConnectorGeometry(
  x0: number, y0: number, hdg0: number,
  x1: number, y1: number, hdg1: number,
): Geometry[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength < 0.01) {
    // Degenerate: return minimal Line
    return [{ s: 0, x: x0, y: y0, hdg: hdg0, length: 0.01, geo_type: 'Line' }];
  }

  // Number of segments (3 for long connectors, 2 for shorter ones)
  const numSegments = chordLength > 30 ? 3 : 2;

  // Sample the Hermite curve at segment boundaries
  // Hermite basis: P(t) = (2t³-3t²+1)P0 + (t³-2t²+t)T0 + (-2t³+3t²)P1 + (t³-t²)T1
  // where T0/T1 are tangent vectors scaled by chord length
  const tangentScale = chordLength; // Scale tangents to match chord for natural curve
  const t0x = Math.cos(hdg0) * tangentScale;
  const t0y = Math.sin(hdg0) * tangentScale;
  const t1x = Math.cos(hdg1) * tangentScale;
  const t1y = Math.sin(hdg1) * tangentScale;

  // Evaluate Hermite curve position and tangent at parameter t
  function hermitePos(t: number): { x: number; y: number } {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: h00 * x0 + h10 * t0x + h01 * x1 + h11 * t1x,
      y: h00 * y0 + h10 * t0y + h01 * y1 + h11 * t1y,
    };
  }

  function hermiteTangent(t: number): { tx: number; ty: number } {
    const t2 = t * t;
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;
    const dh11 = 3 * t2 - 2 * t;
    return {
      tx: dh00 * x0 + dh10 * t0x + dh01 * x1 + dh11 * t1x,
      ty: dh00 * y0 + dh10 * t0y + dh01 * y1 + dh11 * t1y,
    };
  }

  // Split into segments at equal parameter intervals
  const geometries: Geometry[] = [];
  let sAccum = 0;

  for (let seg = 0; seg < numSegments; seg++) {
    const tStart = seg / numSegments;
    const tEnd = (seg + 1) / numSegments;

    const pStart = hermitePos(tStart);
    const tanStart = hermiteTangent(tStart);
    const segHdg = Math.atan2(tanStart.ty, tanStart.tx);

    // Estimate segment arc-length
    const subSamples = 20;
    let segLen = 0;
    let prev = pStart;
    for (let i = 1; i <= subSamples; i++) {
      const t = tStart + (tEnd - tStart) * (i / subSamples);
      const pt = hermitePos(t);
      segLen += Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
      prev = pt;
    }
    segLen = Math.max(segLen, 0.01);

    // Fit paramPoly3 to this segment in local frame
    // Local frame: origin at pStart, x-axis along segHdg
    const cosH = Math.cos(segHdg);
    const sinH = Math.sin(segHdg);

    // Sample points in local frame and fit cubic
    const samples: { t: number; u: number; v: number }[] = [];
    for (let i = 0; i <= 10; i++) {
      const tParam = i / 10;
      const tGlobal = tStart + (tEnd - tStart) * tParam;
      const pt = hermitePos(tGlobal);
      const lx = pt.x - pStart.x;
      const ly = pt.y - pStart.y;
      // Rotate to local frame
      const u = lx * cosH + ly * sinH;
      const v = -lx * sinH + ly * cosH;
      samples.push({ t: tParam, u, v });
    }

    // Fit cubic u(t) and v(t) using endpoint + tangent constraints (Hermite in local)
    const uEnd = samples[10]!.u;
    const vEnd = samples[10]!.v;

    // Local tangent at start
    const tanEnd = hermiteTangent(tEnd);
    const localTanStartU = tanStart.tx * cosH + tanStart.ty * sinH;
    const localTanStartV = -tanStart.tx * sinH + tanStart.ty * cosH;
    const localTanEndU = tanEnd.tx * cosH + tanEnd.ty * sinH;
    const localTanEndV = -tanEnd.tx * sinH + tanEnd.ty * cosH;

    // Scale tangents to normalized parameter [0,1]
    const dt = tEnd - tStart; // fraction of total parameter
    const bu = localTanStartU * dt;
    const bv = localTanStartV * dt;
    const endTanU = localTanEndU * dt;
    const endTanV = localTanEndV * dt;

    // Hermite cubic: P(t) where P(0)=0, P'(0)=b, P(1)=end, P'(1)=endTan
    // cu = 3*(uEnd) - 2*bu - endTanU
    // du = -2*(uEnd) + bu + endTanU
    const cu = 3 * uEnd - 2 * bu - endTanU;
    const du = -2 * uEnd + bu + endTanU;
    const cv = 3 * vEnd - 2 * bv - endTanV;
    const dv = -2 * vEnd + bv + endTanV;

    geometries.push({
      s: sAccum,
      x: pStart.x,
      y: pStart.y,
      hdg: segHdg,
      length: segLen,
      geo_type: {
        ParamPoly3: {
          a_u: 0, b_u: bu, c_u: cu, d_u: du,
          a_v: 0, b_v: bv, c_v: cv, d_v: dv,
          p_range: 'Normalized',
        },
      },
    });

    sAccum += segLen;
  }

  return geometries;
}

// ── Junction template → { junction, roads } ─────────────────────────────────

export interface JunctionBuildResult {
  junction: Junction;
  roads: Road[];
  /** Additional junctions (used by roundabout multi-junction topology) */
  extraJunctions?: Junction[];
}

export function buildJunctionFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  if (config.topology === 'Roundabout') {
    return buildRoundaboutFromConfig(config, cx, cy);
  }

  const section = config.armSection ?? DEFAULT_ARM_SECTION;
  const armCount = resolveArmCount(config.topology, config.armCount);
  const gap = computeArmGap(section, armCount, config.armLength);
  const arms = resolveArms(config.topology, cx, cy, gap, config.armCount);
  // Road length = armLength (gap is additional space beyond road, matching C# reference)
  const effLength = config.armLength;
  const junctionId = genId();

  const junctionLink: LinkElement = {
    element_type: 'Junction',
    element_id: junctionId,
    contact_point: null,
  };

  // Arm roads: approach roads that start at the outer tip and end at the junction edge.
  // They point INWARD (toward the junction center), matching OpenDRIVE convention where
  // right-side lanes (negative IDs) carry traffic toward the junction (incoming).
  // successor = Junction because junction is at the end (s=length) of each arm road.
  const armRoads = arms.map((arm) => {
    // arm.x/y is the junction edge position; compute tip position (outer end)
    const tipX = arm.x + Math.cos(arm.hdg) * effLength;
    const tipY = arm.y + Math.sin(arm.hdg) * effLength;
    // Inward heading (toward junction center)
    const inwardHdg = arm.hdg + Math.PI;

    return buildRoad(buildLaneSectionFromConfig(section), {
      x: tipX,
      y: tipY,
      hdg: inwardHdg,
      length: effLength,
      junctionId: null,
      link: { predecessor: null, successor: junctionLink },
    });
  });

  // Add stop line at junction entry for each arm road.
  // Arm roads point inward, so junction edge is at s = length.
  // Stop line is positioned before the crosswalk (driver stops here).
  const roadWidth = section.right.reduce((sum, l) => sum + (l.width ?? 3.5), 0);
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

  // ── Build per-lane connectors (matching C# reference) ────────────────────────
  // Each lane gets its own connector road (1 lane per connector).
  // Lane selection depends on the angular distance between arms:
  //   - Adjacent CW (1 step): all lanes (shoulder + driving)
  //   - Non-adjacent (2 to N-2 steps): driving lanes only (no shoulder)
  //   - Reverse CCW (N-1 steps = 1 step backward): innermost driving lane only

  const connectorRoads: Road[] = [];
  const connections: JunctionConnection[] = [];
  const n = armRoads.length;

  const rightLanes = section.right; // [Driving, Driving, Shoulder] ordered inside→outside

  const pattern = config.connectionPattern ?? 'all-pairs';
  if (pattern === 'all-pairs') {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // CW distance: how many steps clockwise from i to j
        const cwDist = (j - i + n) % n;

        // Select which lanes to connect based on distance
        let lanesToConnect: { laneIdx: number; config: LaneConfig }[];
        if (cwDist === 1) {
          // Adjacent CW: all lanes (shoulder + driving)
          lanesToConnect = rightLanes.map((cfg, idx) => ({ laneIdx: idx, config: cfg }));
        } else if (cwDist === n - 1 && config.topology !== 'T') {
          // Reverse CCW (1 step backward): innermost driving lane only
          // Exception: T-topology has no true reverse (max 90° separation)
          lanesToConnect = [{ laneIdx: 0, config: rightLanes[0]! }];
        } else {
          // Non-adjacent (or T-topology cwDist=n-1): driving lanes only (no shoulder)
          lanesToConnect = rightLanes
            .map((cfg, idx) => ({ laneIdx: idx, config: cfg }))
            .filter(l => l.config.laneType === 'Driving');
        }

        // Create one connector per lane
        for (const { laneIdx, config: laneCfg } of lanesToConnect) {
          const connector = buildSingleLaneConnector(
            armRoads[i]!, armRoads[j]!, junctionId,
            laneCfg, laneIdx, rightLanes,
          );
          connectorRoads.push(connector);
          // Lane link: from incoming arm's lane to connector's single lane
          const fromLaneId = -(laneIdx + 1); // arm lane ID (e.g., -1, -2, -3)
          connections.push({
            id: genId(),
            incoming_road: armRoads[i]!.id,
            connecting_road: connector.id,
            contact_point: 'Start',
            lane_links: [{ from: fromLaneId, to: -1 }],
          });
        }
      }
    }
  }

  // ── Post-processing: add road furniture ────────────────────────────────────

  // Add turn arrows on arm roads
  addTurnArrows(armRoads, n);

  // Add crosswalks at junction-adjacent ends
  addCrosswalks(armRoads);

  // Convert broken lines to solid near junction entry
  solidateBrokenLinesNearJunction(armRoads);

  const junction: Junction = {
    id: junctionId,
    name: config.name ?? '',
    connections,
  };

  return { junction, roads: [...armRoads, ...connectorRoads] };
}

