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
      left: [],
      right: [
        { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
      ],
    },
    {
      id: 'tpl:road:dual2',
      labelKey: 'templatePanel.roads.dual2Lane',
      icon: '┃┃',
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
      topology: 'Roundabout',
      armCount: 4,
      armLength: 100,
      roundaboutRadius: 50,
      name: 'Roundabout 4',
      connectionPattern: 'all-pairs',
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Signals
  // ═══════════════════════════════════════════════════════════════════════════

  signals: [
    { id: 'tpl:sig:traffic-light', labelKey: 'templatePanel.signals.trafficLight', icon: '🚦', signalType: '1000001' },
    { id: 'tpl:sig:stop', labelKey: 'templatePanel.signals.stopSign', icon: '🛑', signalType: '206' },
    { id: 'tpl:sig:warning', labelKey: 'templatePanel.signals.warningSign', icon: '⚠', signalType: '101' },
    { id: 'tpl:sig:give-way', labelKey: 'templatePanel.signals.giveWay', icon: '⬡', signalType: '002' },
    { id: 'tpl:sig:no-entry', labelKey: 'templatePanel.signals.noEntry', icon: '⛔', signalType: '267' },
    { id: 'tpl:sig:no-parking', labelKey: 'templatePanel.signals.noParking', icon: '🚫', signalType: '283' },
    { id: 'tpl:sig:speed30', labelKey: 'templatePanel.signals.speedLimit30', icon: '㉚', signalType: '274' },
    { id: 'tpl:sig:speed60', labelKey: 'templatePanel.signals.speedLimit60', icon: '㊿', signalType: '274.1' },
    { id: 'tpl:sig:speed80', labelKey: 'templatePanel.signals.speedLimit80', icon: '🔢', signalType: '274.2' },
    { id: 'tpl:sig:speed120', labelKey: 'templatePanel.signals.speedLimit120', icon: '🏎', signalType: '274.3' },
    { id: 'tpl:sig:arrow-straight', labelKey: 'templatePanel.signals.arrowStraight', icon: '⬆', signalType: 'Graphics', signalSubtype: 'straight' },
    { id: 'tpl:sig:arrow-left', labelKey: 'templatePanel.signals.arrowLeft', icon: '⬅', signalType: 'Graphics', signalSubtype: 'left' },
    { id: 'tpl:sig:arrow-right', labelKey: 'templatePanel.signals.arrowRight', icon: '➡', signalType: 'Graphics', signalSubtype: 'right' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Markings
  // ═══════════════════════════════════════════════════════════════════════════

  markings: [
    { id: 'tpl:mark:solid-white', labelKey: 'templatePanel.markings.solidWhite', icon: '━', mark: { type: 'Solid' } },
    { id: 'tpl:mark:dashed-white', labelKey: 'templatePanel.markings.dashedWhite', icon: '╌', mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
    { id: 'tpl:mark:solid-yellow', labelKey: 'templatePanel.markings.solidYellow', icon: '🟡', mark: { type: 'Solid', color: 'Yellow' } },
    { id: 'tpl:mark:double-yellow', labelKey: 'templatePanel.markings.doubleYellow', icon: '〓', mark: { type: 'SolidSolid', color: 'Yellow', width: 0.3 } },
    { id: 'tpl:mark:zebra', labelKey: 'templatePanel.markings.zebraCrossing', icon: '🦓', mark: { type: 'Curb', weight: 'Bold', width: 3.0 } },
    { id: 'tpl:mark:no-mark', labelKey: 'templatePanel.markings.noMarking', icon: '✕', mark: { type: 'None', width: 0 } },
    { id: 'tpl:mark:broken-yellow', labelKey: 'templatePanel.markings.brokenYellow', icon: '╌', mark: { type: 'Broken', color: 'Yellow', width: 0.12, laneChange: 'Both' } },
    { id: 'tpl:mark:double-broken', labelKey: 'templatePanel.markings.doubleBroken', icon: '╞', mark: { type: 'BrokenBroken', color: 'Standard', width: 0.12, laneChange: 'Both' } },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Road Objects (附属物)
  // ═══════════════════════════════════════════════════════════════════════════

  objects: [
    { id: 'tpl:obj:crosswalk', labelKey: 'templatePanel.objects.crosswalk', icon: '🚶', objectType: 'Crosswalk', defaultWidth: 3.0, defaultLength: 5.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:stop-line', labelKey: 'templatePanel.objects.stopLine', icon: '⛔', objectType: 'StopLine', defaultWidth: 6.0, defaultLength: 0.4, defaultHeight: 0.0 },
    { id: 'tpl:obj:yield-slow', labelKey: 'templatePanel.objects.yieldSlowLine', icon: '🔽', objectType: 'SlowDownToYieldLine', defaultWidth: 6.0, defaultLength: 0.6, defaultHeight: 0.0 },
    { id: 'tpl:obj:yield-stop', labelKey: 'templatePanel.objects.yieldStopLine', icon: '✋', objectType: 'StopToYieldLine', defaultWidth: 6.0, defaultLength: 0.6, defaultHeight: 0.0 },
    { id: 'tpl:obj:cross-hatch', labelKey: 'templatePanel.objects.crossHatch', icon: '▦', objectType: 'CrossHatchArea', defaultWidth: 4.0, defaultLength: 4.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:woven', labelKey: 'templatePanel.objects.wovenArea', icon: '▥', objectType: 'WovenArea', defaultWidth: 4.0, defaultLength: 6.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:forward-wait', labelKey: 'templatePanel.objects.forwardWaiting', icon: '🚗', objectType: 'ForwardWaitingArea', defaultWidth: 3.5, defaultLength: 5.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:turn-left-wait', labelKey: 'templatePanel.objects.turnLeftWaiting', icon: '↰', objectType: 'TurnLeftWaitingArea', defaultWidth: 3.5, defaultLength: 5.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:parking', labelKey: 'templatePanel.objects.parkingSpace', icon: '🅿', objectType: 'ParkingSpace', defaultWidth: 2.5, defaultLength: 5.0, defaultHeight: 0.0 },
    { id: 'tpl:obj:guardrail', labelKey: 'templatePanel.objects.guardrail', icon: '|', objectType: 'Guardrail', defaultWidth: 0.3, defaultLength: 10.0, defaultHeight: 0.9 },
    { id: 'tpl:obj:barrier', labelKey: 'templatePanel.objects.barrier', icon: '▌', objectType: 'Barrier', defaultWidth: 0.5, defaultLength: 5.0, defaultHeight: 1.0 },
    { id: 'tpl:obj:cone', labelKey: 'templatePanel.objects.trafficCone', icon: '🔸', objectType: 'TrafficCone', defaultWidth: 0.4, defaultLength: 0.4, defaultHeight: 0.7 },
    { id: 'tpl:obj:street-light', labelKey: 'templatePanel.objects.streetLight', icon: '💡', objectType: 'StreetLightPole', defaultWidth: 0.2, defaultLength: 0.2, defaultHeight: 8.0 },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // Signs (标志牌 / 信号灯杆)
  // ═══════════════════════════════════════════════════════════════════════════

  signs: [
    { id: 'tpl:sign:sign-pole', labelKey: 'templatePanel.signs.signPole', icon: '🪧', objectType: 'Sign', defaultWidth: 0.6, defaultHeight: 2.0 },
    { id: 'tpl:sign:gantry', labelKey: 'templatePanel.signs.gantry', icon: '🌉', objectType: 'SignGantry', defaultWidth: 8.0, defaultHeight: 6.0 },
    { id: 'tpl:sign:signal-pole-simple', labelKey: 'templatePanel.signs.simpleSignalPole', icon: '🚦', objectType: 'SimpleSignalPole', defaultWidth: 0.2, defaultHeight: 5.0 },
    { id: 'tpl:sign:traffic-light-pole', labelKey: 'templatePanel.signs.trafficLightPole', icon: '🚦', objectType: 'TrafficLightPole', defaultWidth: 0.2, defaultHeight: 6.0 },
    { id: 'tpl:sign:l-pole', labelKey: 'templatePanel.signs.lTypePole', icon: '⌐', objectType: 'LTypeSignalPole', defaultWidth: 0.2, defaultHeight: 5.5 },
  ],
};

export default catalog;
