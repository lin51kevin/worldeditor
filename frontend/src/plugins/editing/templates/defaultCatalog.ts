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
const SW = 2.5;  // shoulder width (m)

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
      armLength: 80,
      name: 'T-Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        ],
      },
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:cross',
      labelKey: 'templatePanel.junctions.crossIntersection',
      icon: '✜',
      topology: 'Cross',
      armLength: 80,
      name: 'Cross Intersection',
      armSection: {
        left: [
          { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
        ],
        right: [
          { laneType: 'Driving', width: W, mark: { type: 'Solid', color: 'Yellow' } },
          { laneType: 'Driving', width: W, mark: { type: 'Broken', width: 0.12, laneChange: 'Both' } },
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
      armLength: 80,
      name: '5-Way Intersection',
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:6way',
      labelKey: 'templatePanel.junctions.sixWay',
      icon: '✴',
      topology: 'Radial',
      armCount: 6,
      armLength: 80,
      name: '6-Way Intersection',
      connectionPattern: 'all-pairs',
    },
    {
      id: 'tpl:jct:roundabout',
      labelKey: 'templatePanel.junctions.roundabout',
      icon: '⭕',
      topology: 'Roundabout',
      armCount: 4,
      armLength: 60,
      name: 'Roundabout',
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
    { id: 'tpl:sig:speed30', labelKey: 'templatePanel.signals.speedLimit30', icon: '㉚', signalType: '274' },
    { id: 'tpl:sig:speed60', labelKey: 'templatePanel.signals.speedLimit60', icon: '㊿', signalType: '274.1' },
    { id: 'tpl:sig:speed80', labelKey: 'templatePanel.signals.speedLimit80', icon: '🔢', signalType: '274.2' },
    { id: 'tpl:sig:speed120', labelKey: 'templatePanel.signals.speedLimit120', icon: '🏎', signalType: '274.3' },
    { id: 'tpl:sig:no-entry', labelKey: 'templatePanel.signals.noEntry', icon: '⛔', signalType: '267' },
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
  ],
};

export default catalog;
