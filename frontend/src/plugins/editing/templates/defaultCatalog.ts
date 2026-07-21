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
import type { TemplateCatalog } from './schema';
import { roadSignEntries } from './roadSignEntries';

const W = 3.5;   // standard driving lane width (m)
const SW = 2.0;  // shoulder width (m) — matching C# reference

const catalog: TemplateCatalog = {
  version: '1.0.0',

  // ═══════════════════════════════════════════════════════════════════════════
  // Roads
  // ═══════════════════════════════════════════════════════════════════════════

  roads: [
    {
      id: 'tpl:road:single',
      labelKey: 'templatePanel.roads.singleLane',
      icon: '╺',
      thumbnailUrl: '/assets/textures/Roads/OneLane.png',
      left: [],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
      ],
    },
    {
      id: 'tpl:road:dual2',
      labelKey: 'templatePanel.roads.dual2Lane',
      icon: '┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWayTwoLane.png',
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
      ],
    },
    {
      id: 'tpl:road:dual4',
      labelKey: 'templatePanel.roads.dual4Lane',
      icon: '┃┃┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWayFourLaneWithShoulder.png',
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
    },
    {
      id: 'tpl:road:dual6',
      labelKey: 'templatePanel.roads.dual6Lane',
      icon: '┃┃┃┃┃┃',
      thumbnailUrl: '/assets/textures/Roads/TwoWaySixLaneWithShoulder.png',
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
    },
    {
      id: 'tpl:road:highway',
      labelKey: 'templatePanel.roads.highway',
      icon: '🛣',
      left: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
        { laneType: 'Median', width: 1.5, mark: { type: 'Solid' } },
      ],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
        { laneType: 'Median', width: 1.5, mark: { type: 'Solid' } },
      ],
    },
    {
      id: 'tpl:road:ramp',
      labelKey: 'templatePanel.roads.ramp',
      icon: '↗',
      thumbnailUrl: '/assets/textures/Roads/TwoLane.png',
      left: [],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Solid' } },
        { laneType: 'Shoulder', width: SW, mark: { type: 'Solid' } },
      ],
    },
    {
      id: 'tpl:road:urban',
      labelKey: 'templatePanel.roads.urbanRoad',
      icon: '🏙',
      thumbnailUrl: '/assets/textures/Roads/ThreeLane.png',
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
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Junctions
  // ═══════════════════════════════════════════════════════════════════════════

  junctions: [
    {
      id: 'tpl:jct:t',
      labelKey: 'templatePanel.junctions.tIntersection',
      icon: '⊤',
      thumbnailUrl: '/assets/textures/Junctions/JunctionThreeRoads.png',
      topology: 'T',
      armLength: 100,
      name: 'T-Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:t-single',
      labelKey: 'templatePanel.junctions.tSingleLane',
      icon: '⊤',
      thumbnailUrl: '/assets/textures/Junctions/DefaultJunction.png',
      topology: 'T',
      armLength: 60,
      name: 'T-Intersection Single',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:cross',
      labelKey: 'templatePanel.junctions.crossIntersection',
      icon: '✜',
      thumbnailUrl: '/assets/textures/Junctions/JunctionCrossRoad.png',
      topology: 'Cross',
      armLength: 100,
      name: 'Cross Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:fork',
      labelKey: 'templatePanel.junctions.fork',
      icon: '⑂',
      thumbnailUrl: '/assets/textures/Junctions/VirtualJunction.png',
      topology: 'Radial',
      armCount: 3,
      armLength: 100,
      name: 'Fork',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:5way',
      labelKey: 'templatePanel.junctions.fiveWay',
      icon: '✳',
      thumbnailUrl: '/assets/textures/Junctions/JunctionFiveRoads.png',
      topology: 'Radial',
      armCount: 5,
      armLength: 100,
      name: '5-Way Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:6way',
      labelKey: 'templatePanel.junctions.sixWay',
      icon: '✴',
      topology: 'Radial',
      armCount: 6,
      armLength: 100,
      name: '6-Way Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
          { laneType: 'Shoulder', width: SW, mark: { type: 'None' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:roundabout3',
      labelKey: 'templatePanel.junctions.roundabout',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundaboutThree.png',
      topology: 'Roundabout',
      armCount: 3,
      armLength: 100,
      roundaboutRadius: 50,
      name: 'Roundabout 3',
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:roundabout4',
      labelKey: 'templatePanel.junctions.roundabout4',
      icon: '⭕',
      thumbnailUrl: '/assets/textures/Junctions/JunctionRoundabout.png',
      topology: 'Roundabout',
      armCount: 4,
      armLength: 100,
      roundaboutRadius: 50,
      name: 'Roundabout 4',
      connectionPattern: 'all-pairs',
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

    // ── Road Furniture (道路设施) ──
    { id: 'tpl:obj:guardrail', labelKey: 'templatePanel.objects.guardrail', icon: '|', objectType: 'Guardrail', defaultWidth: 0.3, defaultLength: 10.0, defaultHeight: 0.9, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/RoadGuardrail.png' },
    { id: 'tpl:obj:barrier', labelKey: 'templatePanel.objects.barrier', icon: '▌', objectType: 'Barrier', defaultWidth: 0.5, defaultLength: 5.0, defaultHeight: 1.0, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/SidewalkRail.png' },
    { id: 'tpl:obj:cone', labelKey: 'templatePanel.objects.trafficCone', icon: '🔸', objectType: 'TrafficCone', defaultWidth: 0.4, defaultLength: 0.4, defaultHeight: 0.7, subcategory: 'roadFurniture' },
    { id: 'tpl:obj:street-light', labelKey: 'templatePanel.objects.streetLight', icon: '💡', objectType: 'StreetLightPole', defaultWidth: 0.2, defaultLength: 0.2, defaultHeight: 8.0, subcategory: 'roadFurniture', thumbnailUrl: '/assets/textures/Objects/StreetLightPole.png' },
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
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Road Signs — GB 5768 Categories (标志牌 — 中国国标分类)
  // ═══════════════════════════════════════════════════════════════════════════

  roadSigns: roadSignEntries,
};

export default catalog;
