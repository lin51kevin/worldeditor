/**
 * Default Template Catalog
 *
 * All built-in templates expressed as declarative config objects.
 * This replaces the hardcoded template definitions previously inlined
 * in templates.plugin.ts.
 *
 * To add a new template: just add an entry to the appropriate array.
 * The template engine + plugin wiring will pick it up automatically.
 */
import type {
  TemplateCatalog, LaneConfig, MarkConfig, SectionConfig, RoadTemplateConfig,
} from './schema';
import { roadSignEntries } from './roadSignEntries';

const W = 3.5;   // standard driving lane width (m)
const SW = 2.0;  // shoulder width (m) — matching C# reference

// ── C# mark presets (RoadMarkLane* / RoadMarkBorder*) ────────────────────────

const LANE_MARK: MarkConfig = { type: 'Broken', width: 0.12, laneChange: 'Both' };
const BORDER_SOLID: MarkConfig = { type: 'Solid', width: 0.15 };
const BORDER_NONE: MarkConfig = { type: 'None' };
const CENTER_YELLOW: MarkConfig = { type: 'Solid', color: 'Yellow', width: 0.15 };
const CENTER_WHITE: MarkConfig = { type: 'Solid', width: 0.15 };

/**
 * Build one side of a cross-section following C# `BuildRoad.BuildRoadSideSection`:
 * the outermost lane carries the border mark, every inner lane the lane mark.
 * When `hasShoulder` is false no shoulder lane is emitted at all.
 */
function side(nDriving: number, hasShoulder: boolean, borderMark: MarkConfig): LaneConfig[] {
  const total = nDriving + (hasShoulder ? 1 : 0);
  return Array.from({ length: total }, (_, i) => {
    const isOutermost = i === total - 1;
    const isShoulder = hasShoulder && isOutermost;
    return {
      laneType: isShoulder ? 'Shoulder' : 'Driving',
      width: isShoulder ? SW : W,
      mark: isOutermost ? borderMark : LANE_MARK,
    };
  });
}

/** Symmetric two-way cross-section. */
function twoWay(nDriving: number, hasShoulder: boolean, borderMark: MarkConfig): SectionConfig {
  return {
    left: side(nDriving, hasShoulder, borderMark),
    right: side(nDriving, hasShoulder, borderMark),
  };
}

/** Standard junction arm: N driving lanes + shoulder per side (C# junction templates). */
function armSection(nDriving: number): SectionConfig {
  return twoWay(nDriving, true, BORDER_NONE);
}

/** Cross-section shared by the arc / spiral road templates (C# 2-way 4-lane + shoulder). */
const CURVED_SECTION = twoWay(2, true, BORDER_NONE);

/**
 * Lane-count transition template (C# `CreateChangedRoads*`).
 *
 * 2-step sequences use 33 m straights + a 34 m taper (total 100 m);
 * 3-step sequences use 16 m straights + 18 m tapers.
 */
function laneChangeRoad(key: string, sequence: number[], thumbnail: string): RoadTemplateConfig {
  const threeStep = sequence.length > 2;
  return {
    id: `tpl:road:lc:${key}`,
    labelKey: `templatePanel.roads.laneChange.${key}`,
    icon: '⋉',
    thumbnailUrl: `/assets/textures/Roads/${thumbnail}`,
    subcategory: 'laneChange',
    left: [],
    right: side(sequence[0] ?? 1, false, BORDER_SOLID),
    centerMark: CENTER_YELLOW,
    laneChange: {
      sequence,
      laneWidth: W,
      straightLength: threeStep ? 16 : 33,
      transitionLength: threeStep ? 18 : 34,
    },
  };
}

const catalog: TemplateCatalog = {
  version: '1.0.0',

  // ═══════════════════════════════════════════════════════════════════════════
  // Roads
  // ═══════════════════════════════════════════════════════════════════════════

  roads: [
    // ── Basic cross-sections (C# Roads) ──────────────────────────────────────
    {
      id: 'tpl:road:single',
      labelKey: 'templatePanel.roads.singleLane',
      icon: '╺',
      thumbnailUrl: '/assets/textures/Roads/OneLane.png',
      subcategory: 'basic',
      left: [],
      right: side(1, false, BORDER_SOLID),
      centerMark: CENTER_WHITE,
    },
    {
      id: 'tpl:road:oneway2',
      labelKey: 'templatePanel.roads.oneWay2Lane',
      icon: '╺╺',
      thumbnailUrl: '/assets/textures/Roads/TwoLane.png',
      subcategory: 'basic',
      left: [],
      right: side(2, false, BORDER_SOLID),
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:oneway3',
      labelKey: 'templatePanel.roads.oneWay3Lane',
      icon: '╺╺╺',
      thumbnailUrl: '/assets/textures/Roads/ThreeLane.png',
      subcategory: 'basic',
      left: [],
      right: side(3, false, BORDER_SOLID),
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:dual2',
      labelKey: 'templatePanel.roads.dual2Lane',
      icon: '┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWayTwoLane.png',
      subcategory: 'basic',
      ...twoWay(1, false, BORDER_NONE),
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:dual4',
      labelKey: 'templatePanel.roads.dual4Lane',
      icon: '┃┃┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWayFourLaneWithShoulder.png',
      subcategory: 'basic',
      ...twoWay(2, true, BORDER_NONE),
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:dual6',
      labelKey: 'templatePanel.roads.dual6Lane',
      icon: '┃┃┃┃┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWaySixLaneWithShoulder.png',
      subcategory: 'basic',
      ...twoWay(3, true, BORDER_NONE),
      centerMark: CENTER_YELLOW,
    },

    // ── Curved reference lines (C# Curvatur / Spiral) ────────────────────────
    {
      id: 'tpl:road:arc',
      labelKey: 'templatePanel.roads.arcRoad',
      icon: '◜',
      thumbnailUrl: '/assets/textures/Roads/ArcRoad.png',
      subcategory: 'curved',
      drawMode: 'drawArc',
      defaultCurvature: -1 / 200,
      ...CURVED_SECTION,
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:spiral',
      labelKey: 'templatePanel.roads.spiralRoad',
      icon: '◠',
      thumbnailUrl: '/assets/textures/Roads/SpiralRoad.png',
      subcategory: 'curved',
      drawMode: 'drawSpiral',
      spiralCurvature: { start: 1 / 400, end: 1 / 100 },
      ...CURVED_SECTION,
      centerMark: CENTER_YELLOW,
    },

    // ── Lane-count transitions (C# Changed A–L) ──────────────────────────────
    laneChangeRoad('1to2', [1, 2], 'Changed1To2.png'),
    laneChangeRoad('2to1', [2, 1], 'Changed2To1.png'),
    laneChangeRoad('1to2to1', [1, 2, 1], 'Changed1To2To1.png'),
    laneChangeRoad('2to1to2', [2, 1, 2], 'Changed2To1To2.png'),
    laneChangeRoad('2to3', [2, 3], 'Changed2To3.png'),
    laneChangeRoad('3to2', [3, 2], 'Changed3To2.png'),
    laneChangeRoad('2to3to2', [2, 3, 2], 'Changed2To3To2.png'),
    laneChangeRoad('3to2to3', [3, 2, 3], 'Changed3To2To3.png'),
    laneChangeRoad('3to4', [3, 4], 'Changed3To4.png'),
    laneChangeRoad('4to3', [4, 3], 'Changed4To3.png'),
    laneChangeRoad('3to4to3', [3, 4, 3], 'Changed3To4To3.png'),
    laneChangeRoad('4to3to4', [4, 3, 4], 'Changed4To3To4.png'),

    // ── WorldEditor Next extensions (no C# counterpart) ──────────────────────
    {
      id: 'tpl:road:highway',
      labelKey: 'templatePanel.roads.highway',
      icon: '🛣',
      subcategory: 'extended',
      left: [
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
        { laneType: 'Median', width: 1.5, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
        { laneType: 'Median', width: 1.5, mark: { type: 'Solid' } },
      ],
      centerMark: CENTER_YELLOW,
    },
    {
      id: 'tpl:road:ramp',
      labelKey: 'templatePanel.roads.ramp',
      icon: '↗',
      subcategory: 'extended',
      left: [],
      right: [
        { laneType: 'Driving', width: W, mark: LANE_MARK },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
      centerMark: CENTER_WHITE,
    },
    {
      id: 'tpl:road:urban',
      labelKey: 'templatePanel.roads.urbanRoad',
      icon: '🏙',
      subcategory: 'extended',
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
        { laneType: 'Parking', width: 2.5, mark: { type: 'Solid' } },
        { laneType: 'Sidewalk', width: 2.0, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
        { laneType: 'Parking', width: 2.5, mark: { type: 'Solid' } },
        { laneType: 'Sidewalk', width: 2.0, mark: { type: 'Solid' } },
      ],
      centerMark: CENTER_YELLOW,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Junctions
  // ═══════════════════════════════════════════════════════════════════════════

  junctions: [
    // ── Cross roads 3–7 (C# JunctionCrossRoads*) ─────────────────────────────
    {
      id: 'tpl:jct:cross3',
      labelKey: 'templatePanel.junctions.crossRoads3',
      icon: '⑂',
      thumbnailUrl: '/assets/textures/Junctions/JunctionThreeRoads.png',
      topology: 'Radial',
      armCount: 3,
      armLength: 100,
      armOffset: 50,
      name: 'Cross Roads 3',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'crossRoads',
    },
    {
      id: 'tpl:jct:cross',
      labelKey: 'templatePanel.junctions.crossIntersection',
      icon: '✜',
      thumbnailUrl: '/assets/textures/Junctions/JunctionCrossRoad.png',
      topology: 'Cross',
      armLength: 100,
      armOffset: 50,
      name: 'Cross Roads 4',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'crossRoads',
    },
    {
      id: 'tpl:jct:5way',
      labelKey: 'templatePanel.junctions.fiveWay',
      icon: '✳',
      thumbnailUrl: '/assets/textures/Junctions/JunctionFiveRoads.png',
      topology: 'Radial',
      armCount: 5,
      armLength: 100,
      armOffset: 50,
      name: 'Cross Roads 5',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'crossRoads',
    },
    {
      id: 'tpl:jct:6way',
      labelKey: 'templatePanel.junctions.sixWay',
      icon: '✴',
      thumbnailUrl: '/assets/textures/Junctions/JunctionSixRoads.png',
      topology: 'Radial',
      armCount: 6,
      armLength: 100,
      armOffset: 50,
      name: 'Cross Roads 6',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'crossRoads',
    },
    {
      id: 'tpl:jct:7way',
      labelKey: 'templatePanel.junctions.sevenWay',
      icon: '✷',
      thumbnailUrl: '/assets/textures/Junctions/JunctionSevenRoads.png',
      topology: 'Radial',
      armCount: 7,
      armLength: 100,
      armOffset: 50,
      name: 'Cross Roads 7',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'crossRoads',
    },

    // ── Roundabouts 3–7 (C# JunctionRoundAbout*) ─────────────────────────────
    {
      id: 'tpl:jct:roundabout3',
      labelKey: 'templatePanel.junctions.roundabout',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundaboutThree.png',
      topology: 'Roundabout',
      armCount: 3,
      armLength: 100,
      armOffset: 20,
      roundaboutRadius: 50,
      name: 'Roundabout 3',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'roundabout',
    },
    {
      id: 'tpl:jct:roundabout4',
      labelKey: 'templatePanel.junctions.roundabout4',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundabout.png',
      topology: 'Roundabout',
      armCount: 4,
      armLength: 100,
      armOffset: 20,
      roundaboutRadius: 50,
      name: 'Roundabout 4',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'roundabout',
    },
    {
      id: 'tpl:jct:roundabout5',
      labelKey: 'templatePanel.junctions.roundabout5',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundaboutFive.png',
      topology: 'Roundabout',
      armCount: 5,
      armLength: 100,
      armOffset: 20,
      roundaboutRadius: 50,
      name: 'Roundabout 5',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'roundabout',
    },
    {
      id: 'tpl:jct:roundabout6',
      labelKey: 'templatePanel.junctions.roundabout6',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundaboutSix.png',
      topology: 'Roundabout',
      armCount: 6,
      armLength: 100,
      armOffset: 20,
      roundaboutRadius: 50,
      name: 'Roundabout 6',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'roundabout',
    },
    {
      id: 'tpl:jct:roundabout7',
      labelKey: 'templatePanel.junctions.roundabout7',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundaboutSeven.png',
      topology: 'Roundabout',
      armCount: 7,
      armLength: 100,
      armOffset: 20,
      roundaboutRadius: 50,
      name: 'Roundabout 7',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'roundabout',
    },

    // ── Playground loops 2–6 (C# JunctionPlayground*) ────────────────────────
    {
      id: 'tpl:jct:playground2',
      labelKey: 'templatePanel.junctions.playground2',
      icon: '⬭',
      thumbnailUrl: '/assets/textures/Junctions/JunctionPlaygroundTwo.png',
      topology: 'Playground',
      armCount: 2,
      armLength: 30,
      name: 'Playground 2',
      armSection: armSection(1),
      roundaboutLaneCount: 2,
      subcategory: 'playground',
    },
    {
      id: 'tpl:jct:playground3',
      labelKey: 'templatePanel.junctions.playground3',
      icon: '⬭',
      thumbnailUrl: '/assets/textures/Junctions/JunctionPlaygroundThree.png',
      topology: 'Playground',
      armCount: 3,
      armLength: 30,
      name: 'Playground 3',
      armSection: armSection(1),
      roundaboutLaneCount: 2,
      subcategory: 'playground',
    },
    {
      id: 'tpl:jct:playground4',
      labelKey: 'templatePanel.junctions.playground4',
      icon: '⬭',
      thumbnailUrl: '/assets/textures/Junctions/JunctionPlaygroundFour.png',
      topology: 'Playground',
      armCount: 4,
      armLength: 30,
      name: 'Playground 4',
      armSection: armSection(2),
      roundaboutLaneCount: 2,
      subcategory: 'playground',
    },
    {
      id: 'tpl:jct:playground5',
      labelKey: 'templatePanel.junctions.playground5',
      icon: '⬭',
      thumbnailUrl: '/assets/textures/Junctions/JunctionPlaygroundFive.png',
      topology: 'Playground',
      armCount: 5,
      armLength: 30,
      name: 'Playground 5',
      armSection: armSection(2),
      roundaboutLaneCount: 2,
      subcategory: 'playground',
    },
    {
      id: 'tpl:jct:playground6',
      labelKey: 'templatePanel.junctions.playground6',
      icon: '⬭',
      thumbnailUrl: '/assets/textures/Junctions/JunctionPlaygroundSix.png',
      topology: 'Playground',
      armCount: 6,
      armLength: 30,
      name: 'Playground 6',
      armSection: armSection(3),
      roundaboutLaneCount: 3,
      subcategory: 'playground',
    },

    // ── Overpasses 1–3 (C# JunctionXOverpass*) ───────────────────────────────
    {
      id: 'tpl:jct:overpass1',
      labelKey: 'templatePanel.junctions.overpass1',
      icon: '⤫',
      thumbnailUrl: '/assets/textures/Junctions/JunctionOverpassOne.png',
      topology: 'Overpass',
      variant: 1,
      armLength: 100,
      heightDelta: -6,
      rampRadius: 50,
      name: 'Overpass 1',
      armSection: armSection(2),
      subcategory: 'overpass',
    },
    {
      id: 'tpl:jct:overpass2',
      labelKey: 'templatePanel.junctions.overpass2',
      icon: '⤬',
      thumbnailUrl: '/assets/textures/Junctions/JunctionOverpassTwo.png',
      topology: 'Overpass',
      variant: 2,
      armLength: 100,
      heightDelta: -6,
      rampRadius: 50,
      name: 'Overpass 2',
      armSection: armSection(2),
      subcategory: 'overpass',
    },
    {
      id: 'tpl:jct:overpass3',
      labelKey: 'templatePanel.junctions.overpass3',
      icon: '⤪',
      thumbnailUrl: '/assets/textures/Junctions/JunctionOverpassThree.png',
      topology: 'Overpass',
      variant: 3,
      armLength: 100,
      heightDelta: -6,
      rampRadius: 50,
      name: 'Overpass 3',
      armSection: armSection(2),
      subcategory: 'overpass',
    },

    // ── WorldEditor Next extensions (no C# counterpart) ──────────────────────
    {
      id: 'tpl:jct:t',
      labelKey: 'templatePanel.junctions.tIntersection',
      icon: '⊤',
      thumbnailUrl: '/assets/textures/Junctions/VirtualJunction.png',
      topology: 'T',
      armLength: 100,
      armOffset: 50,
      name: 'T-Intersection',
      armSection: armSection(2),
      connectionPattern: 'all-pairs',
      subcategory: 'extended',
    },
    {
      id: 'tpl:jct:t-single',
      labelKey: 'templatePanel.junctions.tSingleLane',
      icon: '⊤',
      thumbnailUrl: '/assets/textures/Junctions/DefaultJunction.png',
      topology: 'T',
      armLength: 60,
      armOffset: 30,
      name: 'T-Intersection Single',
      armSection: armSection(1),
      connectionPattern: 'all-pairs',
      subcategory: 'extended',
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Signals — Traffic Lights only (交通信号灯)
  // ═══════════════════════════════════════════════════════════════════════════

  signals: [
    { id: 'tpl:sig:traffic-light', labelKey: 'templatePanel.signals.trafficLight', icon: '🚦', signalType: '1000001', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/StandardTrafficLight.png' },
    { id: 'tpl:sig:walking-light', labelKey: 'templatePanel.signals.walkingLight', icon: '🚶', signalType: '1000002', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/WalkingTrafficLight.png' },
    { id: 'tpl:sig:forward-light', labelKey: 'templatePanel.signals.forwardLight', icon: '⬆', signalType: '1000011', signalSubtype: '30', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/ForwardTrafficLight.png' },
    { id: 'tpl:sig:left-turn-light', labelKey: 'templatePanel.signals.leftTurnLight', icon: '⬅', signalType: '1000011', signalSubtype: '10', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/TurnLeftTrafficLight.png' },
    { id: 'tpl:sig:right-turn-light', labelKey: 'templatePanel.signals.rightTurnLight', icon: '➡', signalType: '1000011', signalSubtype: '20', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/TurnRightTrafficLight.png' },
    { id: 'tpl:sig:uturn-light', labelKey: 'templatePanel.signals.uturnLight', icon: '↩', signalType: '2000011', signalSubtype: '60', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/TurnUTrafficLight.png' },
    { id: 'tpl:sig:biking-light', labelKey: 'templatePanel.signals.bikingLight', icon: '🚲', signalType: '1000013', subcategory: 'trafficLights', width: 0.6, height: 0.9, thumbnailUrl: '/assets/textures/TrafficLights/BikingTrafficLight.png' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Markings — kept empty (lane markings removed per C# alignment)
  // ═══════════════════════════════════════════════════════════════════════════

  markings: [],

  // ═══════════════════════════════════════════════════════════════════════════
  // Paints — Road surface paint arrows (道路喷漆)
  // ═══════════════════════════════════════════════════════════════════════════

  paints: [
    { id: 'tpl:sig:arrow-straight', labelKey: 'templatePanel.paints.arrowStraight', icon: '⬆', signalType: 'Graphics', signalSubtype: 'straight', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/StraightArrowPaint.png' },
    { id: 'tpl:sig:arrow-left', labelKey: 'templatePanel.paints.arrowLeft', icon: '⬅', signalType: 'Graphics', signalSubtype: 'left', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/LeftTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-right', labelKey: 'templatePanel.paints.arrowRight', icon: '➡', signalType: 'Graphics', signalSubtype: 'right', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/RightTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-uturn', labelKey: 'templatePanel.paints.arrowUturn', icon: '↩', signalType: 'Graphics', signalSubtype: 'uturn', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/UTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-straight-left', labelKey: 'templatePanel.paints.arrowStraightLeft', icon: '↖', signalType: 'Graphics', signalSubtype: 'straight_left', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/StraightLeftTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-straight-right', labelKey: 'templatePanel.paints.arrowStraightRight', icon: '↗', signalType: 'Graphics', signalSubtype: 'straight_right', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/StraightRightTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-left-right', labelKey: 'templatePanel.paints.arrowLeftRight', icon: '↔', signalType: 'Graphics', signalSubtype: 'left_right', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/LeftOrRightTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-all', labelKey: 'templatePanel.paints.arrowAll', icon: '✦', signalType: 'Graphics', signalSubtype: 'straight_left_right', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/StraightOrLeftOrRightTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-straight-uturn', labelKey: 'templatePanel.paints.arrowStraightUturn', icon: '⤴', signalType: 'Graphics', signalSubtype: 'straight_uturn', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/StraightUTurnArrowPaint.png' },
    { id: 'tpl:sig:arrow-left-uturn', labelKey: 'templatePanel.paints.arrowLeftUturn', icon: '↶', signalType: 'Graphics', signalSubtype: 'left_uturn', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/LeftOrUTurnArrowPaint.png' },
    { id: 'tpl:sig:merge-left', labelKey: 'templatePanel.paints.mergeLeft', icon: '⇐', signalType: 'Graphics', signalSubtype: 'merge_left', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/MergeToLeftLaneArrowPaint.png' },
    { id: 'tpl:sig:merge-right', labelKey: 'templatePanel.paints.mergeRight', icon: '⇒', signalType: 'Graphics', signalSubtype: 'merge_right', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/MergeToRightLaneArrowPaint.png' },
    { id: 'tpl:sig:bicycle-paint', labelKey: 'templatePanel.paints.bicyclePaint', icon: '🚲', signalType: 'Graphics', signalSubtype: 'bicycle', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/BycyclePaint.png' },
    { id: 'tpl:sig:pedestrian-paint', labelKey: 'templatePanel.paints.pedestrianPaint', icon: '🚶', signalType: 'Graphics', signalSubtype: 'pedestrian', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/PedestrianPaint.png' },
    { id: 'tpl:sig:disabled-paint', labelKey: 'templatePanel.paints.disabledPaint', icon: '♿', signalType: 'Graphics', signalSubtype: 'disabled', subcategory: 'roadPaints', thumbnailUrl: '/assets/textures/RoadPaints/DisabledPaint.png' },
    { id: 'tpl:sig:crosswalk-warning-diamond', labelKey: 'templatePanel.paints.crosswalkWarningDiamond', icon: '◇', signalType: 'Graphics', signalSubtype: 'CrosswalkWarningDiamond', subcategory: 'roadPaints', width: 1.5 },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Road Objects (附属物) — grouped by subcategory
  // ═══════════════════════════════════════════════════════════════════════════

  objects: [
    // ── Surface Markings (路面标记) ──
    { id: 'tpl:obj:crosswalk', labelKey: 'templatePanel.objects.crosswalk', icon: '🚶', objectType: 'Crosswalk', defaultWidth: 3.0, defaultLength: 5.0, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/ZebraStripsArea.png', drawMode: 'polygon' },
    { id: 'tpl:obj:stop-line', labelKey: 'templatePanel.objects.stopLine', icon: '⛔', objectType: 'StopLine', defaultWidth: 6.0, defaultLength: 0.4, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/StopLine.png', drawMode: 'line' },
    { id: 'tpl:obj:yield-slow', labelKey: 'templatePanel.objects.yieldSlowLine', icon: '🔽', objectType: 'SlowDownToYieldLine', defaultWidth: 6.0, defaultLength: 0.6, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/SlowDownToYieldLine.png', drawMode: 'line' },
    { id: 'tpl:obj:yield-stop', labelKey: 'templatePanel.objects.yieldStopLine', icon: '✋', objectType: 'StopToYieldLine', defaultWidth: 6.0, defaultLength: 0.6, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/StopToYieldLine.png', drawMode: 'line' },
    { id: 'tpl:obj:forward-wait', labelKey: 'templatePanel.objects.forwardWaiting', icon: '🚗', objectType: 'ForwardWaitingArea', defaultWidth: 3.5, defaultLength: 5.0, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/ForwardWaitingArea.png', drawMode: 'polygon' },
    { id: 'tpl:obj:turn-left-wait', labelKey: 'templatePanel.objects.turnLeftWaiting', icon: '↰', objectType: 'TurnLeftWaitingArea', defaultWidth: 3.5, defaultLength: 5.0, defaultHeight: 0.0, subcategory: 'surfaceMarkings', thumbnailUrl: '/assets/textures/Objects/TurnLeftWaitingArea.png', drawMode: 'polygon' },

    // ── Area Markings (区域标记) ──
    { id: 'tpl:obj:cross-hatch', labelKey: 'templatePanel.objects.crossHatch', icon: '▦', objectType: 'CrossHatchArea', defaultWidth: 4.0, defaultLength: 4.0, defaultHeight: 0.0, subcategory: 'areaMarkings', thumbnailUrl: '/assets/textures/Objects/CrossHatchArea.png', drawMode: 'polygon' },
    { id: 'tpl:obj:woven', labelKey: 'templatePanel.objects.wovenArea', icon: '▥', objectType: 'WovenArea', defaultWidth: 4.0, defaultLength: 6.0, defaultHeight: 0.0, subcategory: 'areaMarkings', thumbnailUrl: '/assets/textures/Objects/WovenArea.png', drawMode: 'polygon' },
    { id: 'tpl:obj:parking', labelKey: 'templatePanel.objects.parkingSpace', icon: '🅿', objectType: 'ParkingSpace', defaultWidth: 2.5, defaultLength: 5.0, defaultHeight: 0.0, subcategory: 'areaMarkings', thumbnailUrl: '/assets/textures/Objects/ParkingSpace.png', drawMode: 'polygon' },
    { id: 'tpl:obj:simple-cross-hatch', labelKey: 'templatePanel.objects.simpleCrossHatch', icon: '▤', objectType: 'SimpleCrossHatch', defaultWidth: 3.0, defaultLength: 5.0, defaultHeight: 0.0, subcategory: 'areaMarkings', thumbnailUrl: '/assets/textures/Objects/SimpleCrossHatchArea.png', drawMode: 'polygon' },

    // ── Road Furniture (道路设施) ──
    { id: 'tpl:obj:guardrail', labelKey: 'templatePanel.objects.guardrail', icon: '|', objectType: 'Guardrail', defaultWidth: 0.3, defaultLength: 10.0, defaultHeight: 0.9, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/RoadGuardrail.png', drawMode: 'line' },
    { id: 'tpl:obj:barrier', labelKey: 'templatePanel.objects.barrier', icon: '▌', objectType: 'Barrier', defaultWidth: 0.5, defaultLength: 5.0, defaultHeight: 1.0, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/SidewalkRail.png', drawMode: 'line' },
    { id: 'tpl:obj:sidewalk-rail', labelKey: 'templatePanel.objects.sidewalkRail', icon: '⌸', objectType: 'SidewalkRail', defaultWidth: 0.2, defaultLength: 10.0, defaultHeight: 1.1, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/SidewalkRail.png', drawMode: 'line' },
    { id: 'tpl:obj:curb', labelKey: 'templatePanel.objects.curb', icon: '▃', objectType: 'Curb', defaultWidth: 0.3, defaultLength: 10.0, defaultHeight: 0.15, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/Curb.png', drawMode: 'line' },
    { id: 'tpl:obj:flower-bed', labelKey: 'templatePanel.objects.flowerBed', icon: '🌿', objectType: 'FlowerBed', defaultWidth: 1.2, defaultLength: 10.0, defaultHeight: 0.5, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/FlowerBed.png', drawMode: 'line' },
    { id: 'tpl:obj:trash-bin', labelKey: 'templatePanel.objects.trashBin', icon: '🗑', objectType: 'TrashBin', defaultWidth: 0.6, defaultLength: 0.6, defaultHeight: 1.0, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/TrashBin.png' },
    { id: 'tpl:obj:cone', labelKey: 'templatePanel.objects.trafficCone', icon: '🔸', objectType: 'TrafficCone', defaultWidth: 0.4, defaultLength: 0.4, defaultHeight: 0.7, subcategory: 'roadFurniture' },
    { id: 'tpl:obj:street-light', labelKey: 'templatePanel.objects.streetLight', icon: '💡', objectType: 'StreetLightPole', defaultWidth: 0.2, defaultLength: 0.2, defaultHeight: 8.0, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/StreetLightPole.png' },

    // ── Structures (构造物) ──
    { id: 'tpl:obj:bridge', labelKey: 'templatePanel.objects.bridge', icon: '🌉', objectType: 'Bridge', defaultWidth: 12.0, defaultLength: 30.0, defaultHeight: 0.0, subcategory: 'structures', drawMode: 'line' },
    { id: 'tpl:obj:tunnel', labelKey: 'templatePanel.objects.tunnel', icon: '🕳', objectType: 'Tunnel', defaultWidth: 12.0, defaultLength: 50.0, defaultHeight: 0.0, subcategory: 'structures', drawMode: 'line' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Signs (标志牌 / 信号灯杆)
  // ═══════════════════════════════════════════════════════════════════════════

  signs: [
    { id: 'tpl:sign:sign-pole', labelKey: 'templatePanel.signs.signPole', icon: '🪧', objectType: 'Sign', defaultWidth: 0.6, defaultHeight: 2.0, thumbnailUrl: '/assets/textures/Objects/Pole.png' },
    { id: 'tpl:sign:gantry', labelKey: 'templatePanel.signs.gantry', icon: '🌉', objectType: 'SignGantry', defaultWidth: 8.0, defaultHeight: 6.0, thumbnailUrl: '/assets/textures/Objects/SignGantry.png' },
    { id: 'tpl:sign:signal-pole-simple', labelKey: 'templatePanel.signs.simpleSignalPole', icon: '🚦', objectType: 'SimpleSignalPole', defaultWidth: 0.2, defaultHeight: 5.0, thumbnailUrl: '/assets/textures/Objects/SimpleSignalPole.png' },
    { id: 'tpl:sign:traffic-light-pole', labelKey: 'templatePanel.signs.trafficLightPole', icon: '🚦', objectType: 'TrafficLightPole', defaultWidth: 0.2, defaultHeight: 6.0, thumbnailUrl: '/assets/textures/Objects/TrafficLightPole.png' },
    { id: 'tpl:sign:l-pole', labelKey: 'templatePanel.signs.lTypePole', icon: '⌐', objectType: 'LTypeSignalPole', defaultWidth: 0.2, defaultHeight: 5.5, thumbnailUrl: '/assets/textures/Objects/LTypeSignalPole.png' },
    { id: 'tpl:sign:t-pole', labelKey: 'templatePanel.signs.tTypePole', icon: '⊤', objectType: 'TTypeSignalPole', defaultWidth: 0.2, defaultHeight: 5.5, thumbnailUrl: '/assets/textures/Objects/TTYpeSignalPole.png' },
    { id: 'tpl:sign:plain-pole', labelKey: 'templatePanel.signs.pole', icon: '│', objectType: 'Pole', defaultWidth: 0.15, defaultHeight: 3.0, thumbnailUrl: '/assets/textures/Objects/Pole.png' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Road Signs — GB 5768 Categories (标志牌 — 中国国标分类)
  // ═══════════════════════════════════════════════════════════════════════════

  roadSigns: roadSignEntries,
};

export default catalog;
