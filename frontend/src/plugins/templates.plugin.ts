/**
 * Built-in Templates Plugin
 *
 * Registers four template sections into the TemplatePanel:
 *  - Roads (道路): predefined road cross-section types
 *  - Junctions (交汇处): intersection / fork patterns
 *  - Signals (信号): traffic signs and lights
 *  - Markings (喷漆): road surface paint/mark presets
 *
 * Call mountTemplatesPlugin() once on app init; returns a cleanup function.
 */
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { TemplateSectionContrib } from '../stores/pluginContribStore';
import type { Road, Lane, LaneSection, Geometry, RoadMark, RoadSignal, Junction, JunctionConnection, LinkElement } from '../services/platform';

const PLUGIN_ID = 'builtin-templates';
const LANE_WIDTH = 3.5;
const SHOULDER_WIDTH = 2.5;
const ROAD_LENGTH = 100;

// ── Domain object helpers ────────────────────────────────────────────────────

function makeLane(id: number, laneType = 'Driving', width = LANE_WIDTH, marks: RoadMark[] = []): Lane {
  return {
    id,
    lane_type: laneType,
    level: 0,
    link: { predecessor: null, successor: null },
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    borders: [],
    road_marks: marks,
  };
}

function solidLine(color: 'Standard' | 'Yellow' = 'Standard'): RoadMark {
  return { s_offset: 0, mark_type: 'Solid', weight: 'Standard', color, material: 'standard', width: 0.15, lane_change: 'None' };
}

function dashedLine(): RoadMark {
  return { s_offset: 0, mark_type: 'Broken', weight: 'Standard', color: 'Standard', material: 'standard', width: 0.12, lane_change: 'Both' };
}

function makeLaneSection(
  leftConfig: Array<[number, string, number, RoadMark[]]>,
  rightConfig: Array<[number, string, number, RoadMark[]]>,
): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: leftConfig.map(([id, type, w, marks]) => makeLane(id, type, w, marks)),
    center: [makeLane(0, 'None')],
    right: rightConfig.map(([id, type, w, marks]) => makeLane(-id, type, w, marks)),
  };
}

function makeLineGeometry(x: number, y: number, hdg: number, length = ROAD_LENGTH): Geometry {
  return { s: 0, x, y, hdg, length, geo_type: 'Line' };
}

function makeRoad(
  laneSection: LaneSection,
  x = 0,
  y = 0,
  hdg = 0,
  length = ROAD_LENGTH,
  junctionId: string | null = null,
): Road {
  return {
    id: `road_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    length,
    junction_id: junctionId,
    link: { predecessor: null, successor: null },
    plan_view: [makeLineGeometry(x, y, hdg, length)],
    elevation_profile: [],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
    lane_sections: [laneSection],
  };
}

// ── Road Templates ───────────────────────────────────────────────────────────

function applyRoadTemplate(laneSection: LaneSection, opts?: { x?: number; y?: number; hdg?: number }) {
  // Guard: only create when explicit world coordinates are provided (drag-to-viewport).
  if (opts?.x === undefined || opts?.y === undefined) return;
  const road = makeRoad(laneSection, opts.x, opts.y, opts.hdg ?? 0);
  const store = useProjectStore.getState();
  store.addRoad(road);
  store.selectRoad(road.id);
}

const roadSection: TemplateSectionContrib = {
  id: `${PLUGIN_ID}:roads`,
  pluginId: PLUGIN_ID,
  categoryKey: 'templatePanel.categories.roads',
  order: 0,
  items: [
    {
      id: 'tpl:road:single',
      labelKey: 'templatePanel.roads.singleLane',
      icon: '╺',
      onApply: (opts) => applyRoadTemplate(makeLaneSection([], [[1, 'Driving', LANE_WIDTH, [dashedLine()]]]), opts),
    },
    {
      id: 'tpl:road:dual2',
      labelKey: 'templatePanel.roads.dual2Lane',
      icon: '┃┃',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection(
          [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]]],
          [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]]],
        ),
        opts,
      ),
    },
    {
      id: 'tpl:road:dual4',
      labelKey: 'templatePanel.roads.dual4Lane',
      icon: '┃┃┃┃',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection(
          [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [2, 'Shoulder', SHOULDER_WIDTH, [solidLine()]]],
          [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [2, 'Shoulder', SHOULDER_WIDTH, [solidLine()]]],
        ),
        opts,
      ),
    },
    {
      id: 'tpl:road:dual6',
      labelKey: 'templatePanel.roads.dual6Lane',
      icon: '┃┃┃┃┃┃',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection(
          [[1, 'Driving', LANE_WIDTH, [dashedLine()]], [2, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [3, 'Shoulder', SHOULDER_WIDTH, [solidLine()]]],
          [[1, 'Driving', LANE_WIDTH, [dashedLine()]], [2, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [3, 'Shoulder', SHOULDER_WIDTH, [solidLine()]]],
        ),
        opts,
      ),
    },
    {
      id: 'tpl:road:highway',
      labelKey: 'templatePanel.roads.highway',
      icon: '🛣',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection(
          [[1, 'Driving', LANE_WIDTH, [dashedLine()]], [2, 'Driving', LANE_WIDTH, [dashedLine()]], [3, 'Driving', LANE_WIDTH, [solidLine()]], [4, 'Shoulder', SHOULDER_WIDTH, [solidLine()]], [5, 'Median', 1.5, [solidLine()]]],
          [[1, 'Driving', LANE_WIDTH, [dashedLine()]], [2, 'Driving', LANE_WIDTH, [dashedLine()]], [3, 'Driving', LANE_WIDTH, [solidLine()]], [4, 'Shoulder', SHOULDER_WIDTH, [solidLine()]], [5, 'Median', 1.5, [solidLine()]]],
        ),
        opts,
      ),
    },
    {
      id: 'tpl:road:ramp',
      labelKey: 'templatePanel.roads.ramp',
      icon: '↗',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection([], [[1, 'Driving', LANE_WIDTH, [solidLine()]], [2, 'Shoulder', SHOULDER_WIDTH, [solidLine()]]]),
        opts,
      ),
    },
    {
      id: 'tpl:road:urban',
      labelKey: 'templatePanel.roads.urbanRoad',
      icon: '🏙',
      onApply: (opts) => applyRoadTemplate(
        makeLaneSection(
          [[1, 'Driving', LANE_WIDTH, [solidLine()]], [2, 'Parking', 2.5, [solidLine()]], [3, 'Sidewalk', 2.0, [solidLine()]]],
          [[1, 'Driving', LANE_WIDTH, [solidLine()]], [2, 'Parking', 2.5, [solidLine()]], [3, 'Sidewalk', 2.0, [solidLine()]]],
        ),
        opts,
      ),
    },
  ],
};

// ── Junction Templates ───────────────────────────────────────────────────────

/**
 * Creates N roads radiating outward from a centre point to form a fork junction.
 * Roads are labelled as junction-member roads (junction_id is set).
 */
function applyJunctionTemplate(armCount: number, armLength: number, opts?: { x?: number; y?: number }) {
  // Guard: only create when explicit world coordinates are provided (drag-to-viewport).
  if (opts?.x === undefined || opts?.y === undefined) return;
  const cx = opts.x;
  const cy = opts.y;
  const junctionId = `junction_${Date.now()}`;
  const junction: Junction = {
    id: junctionId,
    name: '',
    connections: [],
  };

  const laneSection = makeLaneSection(
    [[1, 'Driving', LANE_WIDTH, [solidLine()]]],
    [[1, 'Driving', LANE_WIDTH, [solidLine()]]],
  );

  const roads: Road[] = [];
  for (let i = 0; i < armCount; i++) {
    const angle = (i * 2 * Math.PI) / armCount;
    roads.push(makeRoad(laneSection, cx, cy, angle, armLength, junctionId));
  }

  useProjectStore.getState().addJunctionWithRoads(junction, roads);
  useProjectStore.getState().selectJunction(junctionId);
}

// ── Dual 4-lane section helper ───────────────────────────────────────────────

/** Bidirectional 4-lane: 2 driving lanes per direction with proper markings.
 *  - Inner lanes (id ±1): solid yellow center line (no lane-change)
 *  - Outer lanes (id ±2): dashed white (lane-change allowed)
 */
function dual4LaneSection(): LaneSection {
  return makeLaneSection(
    [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [2, 'Driving', LANE_WIDTH, [dashedLine()]]],
    [[1, 'Driving', LANE_WIDTH, [solidLine('Yellow')]], [2, 'Driving', LANE_WIDTH, [dashedLine()]]],
  );
}

let junctionSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++junctionSeq).toString(36)}`;
}

/**
 * T-intersection with bidirectional 4-lane arms.
 *
 * Creates 3 arms in a T-shape (east + west main road, north branch) with
 * a gap between the arm starts so the junction polygon can be rendered.
 * Arm roads have their predecessor link referencing the junction.
 * Junction connections are populated for all 6 directed pairs.
 */
function applyTIntersectionDual4(armLength: number, opts?: { x?: number; y?: number }) {
  if (opts?.x === undefined || opts?.y === undefined) return;
  const cx = opts.x;
  const cy = opts.y;
  const junctionId = nextId('junction');

  // Gap = half the road width so arms don't overlap at the center
  const section = dual4LaneSection();
  const halfWidth = 2 * LANE_WIDTH; // 2 lanes × 3.5m = 7m per side
  const gap = halfWidth + 1.0; // 8m clearance

  // Arm roads start at `gap` distance from center, heading outward.
  // s=0 is at the junction boundary; s=length reaches the arm tip.
  const effLength = armLength - gap;
  const roadEast = makeRoad(section, cx + gap, cy, 0, effLength, null);
  const roadWest = makeRoad(section, cx - gap, cy, Math.PI, effLength, null);
  const roadNorth = makeRoad(section, cx, cy + gap, Math.PI / 2, effLength, null);

  // Link each arm's start (s=0) to the junction
  const junctionLink: LinkElement = { element_type: 'Junction', element_id: junctionId, contact_point: null };
  roadEast.link = { predecessor: junctionLink, successor: null };
  roadWest.link = { predecessor: junctionLink, successor: null };
  roadNorth.link = { predecessor: junctionLink, successor: null };

  // Junction connections: every directed pair of arms.
  // connecting_road's contact_point=Start means the junction polygon builder
  // samples the road at s=0 (the junction boundary).
  const makeConn = (incoming: Road, connecting: Road): JunctionConnection => ({
    id: nextId('conn'),
    incoming_road: incoming.id,
    connecting_road: connecting.id,
    contact_point: 'Start',
    lane_links: [
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: -1, to: -1 },
      { from: -2, to: -2 },
    ],
  });

  const junction: Junction = {
    id: junctionId,
    name: 'T-Intersection',
    connections: [
      makeConn(roadEast, roadWest),
      makeConn(roadWest, roadEast),
      makeConn(roadEast, roadNorth),
      makeConn(roadNorth, roadEast),
      makeConn(roadWest, roadNorth),
      makeConn(roadNorth, roadWest),
    ],
  };

  const store = useProjectStore.getState();
  store.addJunctionWithRoads(junction, [roadEast, roadWest, roadNorth]);
  store.selectJunction(junctionId);
}

const junctionSection: TemplateSectionContrib = {
  id: `${PLUGIN_ID}:junctions`,
  pluginId: PLUGIN_ID,
  categoryKey: 'templatePanel.categories.junctions',
  order: 1,
  items: [
    {
      id: 'tpl:jct:t',
      labelKey: 'templatePanel.junctions.tIntersection',
      icon: '⊤',
      onApply: (opts) => applyTIntersectionDual4(80, opts),
    },
    {
      id: 'tpl:jct:cross',
      labelKey: 'templatePanel.junctions.crossIntersection',
      icon: '✜',
      onApply: (opts) => applyJunctionTemplate(4, 80, opts),
    },
    {
      id: 'tpl:jct:5way',
      labelKey: 'templatePanel.junctions.fiveWay',
      icon: '✳',
      onApply: (opts) => applyJunctionTemplate(5, 80, opts),
    },
    {
      id: 'tpl:jct:6way',
      labelKey: 'templatePanel.junctions.sixWay',
      icon: '✴',
      onApply: (opts) => applyJunctionTemplate(6, 80, opts),
    },
    {
      id: 'tpl:jct:roundabout',
      labelKey: 'templatePanel.junctions.roundabout',
      icon: '⭕',
      onApply: (opts) => applyJunctionTemplate(4, 60, opts),
    },
  ],
};

// ── Signal Templates ─────────────────────────────────────────────────────────

function applySignalTemplate(type: string, _opts?: { x?: number; y?: number }) {
  // Signals don't require world position (they attach to selected road at s=0).
  // Guard: only create when a road is selected.
  const store = useProjectStore.getState();
  if (!store.selectedRoadId) return;
  const signal: RoadSignal = {
    id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    s: 0,
    t: 0,
    z_offset: 0,
    h_offset: 0,
    width: 1.0,
    height: 2.0,
    signal_type: type,
    signal_subtype: '-1',
    value: null,
    orientation: '+',
    is_dynamic: false,
  };
  store.addSignal(signal);
}

const signalSection: TemplateSectionContrib = {
  id: `${PLUGIN_ID}:signals`,
  pluginId: PLUGIN_ID,
  categoryKey: 'templatePanel.categories.signals',
  order: 2,
  items: [
    { id: 'tpl:sig:traffic-light', labelKey: 'templatePanel.signals.trafficLight', icon: '🚦', onApply: (opts) => applySignalTemplate('1000001', opts) },
    { id: 'tpl:sig:stop', labelKey: 'templatePanel.signals.stopSign', icon: '🛑', onApply: (opts) => applySignalTemplate('206', opts) },
    { id: 'tpl:sig:warning', labelKey: 'templatePanel.signals.warningSign', icon: '⚠', onApply: (opts) => applySignalTemplate('101', opts) },
    { id: 'tpl:sig:speed30', labelKey: 'templatePanel.signals.speedLimit30', icon: '㉚', onApply: (opts) => applySignalTemplate('274', opts) },
    { id: 'tpl:sig:speed60', labelKey: 'templatePanel.signals.speedLimit60', icon: '㊿', onApply: (opts) => applySignalTemplate('274.1', opts) },
    { id: 'tpl:sig:speed80', labelKey: 'templatePanel.signals.speedLimit80', icon: '🔢', onApply: (opts) => applySignalTemplate('274.2', opts) },
    { id: 'tpl:sig:speed120', labelKey: 'templatePanel.signals.speedLimit120', icon: '🏎', onApply: (opts) => applySignalTemplate('274.3', opts) },
    { id: 'tpl:sig:no-entry', labelKey: 'templatePanel.signals.noEntry', icon: '⛔', onApply: (opts) => applySignalTemplate('267', opts) },
  ],
};

// ── Marking / Paint Templates ────────────────────────────────────────────────

/** Replaces road marks on all driving lanes in the selected road's first section. */
function applyMarkingTemplate(mark: RoadMark) {
  const { selectedRoadId, project } = useProjectStore.getState();
  if (!selectedRoadId) return;
  const road = project.roads.find((r) => r.id === selectedRoadId);
  if (!road || road.lane_sections.length === 0) return;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const section = road.lane_sections[0]!;
  const applyMark = (lanes: Lane[]): Lane[] =>
    lanes.map((lane) =>
      lane.lane_type === 'Driving' ? { ...lane, road_marks: [mark] } : lane,
    );

  const updatedSection: LaneSection = {
    ...section,
    left: applyMark(section.left),
    right: applyMark(section.right),
  };
  const updatedRoad: Road = {
    ...road,
    lane_sections: road.lane_sections.map((s, i) => (i === 0 ? updatedSection : s)),
  };

  // Patch the project directly via setProject to avoid a separate store action
  const { project: proj } = useProjectStore.getState();
  useProjectStore.getState().setProject({
    ...proj,
    roads: proj.roads.map((r) => (r.id === selectedRoadId ? updatedRoad : r)),
  });
  useProjectStore.getState().markDirty();
}

const markingSection: TemplateSectionContrib = {
  id: `${PLUGIN_ID}:markings`,
  pluginId: PLUGIN_ID,
  categoryKey: 'templatePanel.categories.markings',
  order: 3,
  items: [
    {
      id: 'tpl:mark:solid-white',
      labelKey: 'templatePanel.markings.solidWhite',
      icon: '━',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'Solid', weight: 'Standard', color: 'Standard', material: 'standard', width: 0.15, lane_change: 'None' }),
    },
    {
      id: 'tpl:mark:dashed-white',
      labelKey: 'templatePanel.markings.dashedWhite',
      icon: '╌',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'Broken', weight: 'Standard', color: 'Standard', material: 'standard', width: 0.12, lane_change: 'Both' }),
    },
    {
      id: 'tpl:mark:solid-yellow',
      labelKey: 'templatePanel.markings.solidYellow',
      icon: '🟡',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'Solid', weight: 'Standard', color: 'Yellow', material: 'standard', width: 0.15, lane_change: 'None' }),
    },
    {
      id: 'tpl:mark:double-yellow',
      labelKey: 'templatePanel.markings.doubleYellow',
      icon: '〓',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'SolidSolid', weight: 'Standard', color: 'Yellow', material: 'standard', width: 0.3, lane_change: 'None' }),
    },
    {
      id: 'tpl:mark:zebra',
      labelKey: 'templatePanel.markings.zebraCrossing',
      icon: '🦓',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'Curb', weight: 'Bold', color: 'Standard', material: 'standard', width: 3.0, lane_change: 'None' }),
    },
    {
      id: 'tpl:mark:no-mark',
      labelKey: 'templatePanel.markings.noMarking',
      icon: '✕',
      onApply: () => applyMarkingTemplate({ s_offset: 0, mark_type: 'None', weight: 'Standard', color: 'Standard', material: 'standard', width: 0, lane_change: 'None' }),
    },
  ],
};

// ── Plugin mount/unmount ─────────────────────────────────────────────────────

export function mountTemplatesPlugin(): () => void {
  const { registerTemplateSection, unregisterPlugin } = usePluginContribStore.getState();

  registerTemplateSection(roadSection);
  registerTemplateSection(junctionSection);
  registerTemplateSection(signalSection);
  registerTemplateSection(markingSection);

  return () => unregisterPlugin(PLUGIN_ID);
}
