/**
 * Template Configuration Schema
 *
 * Declarative interfaces for describing road, junction, signal, and marking
 * templates as plain data. The template engine interprets these configs and
 * produces domain objects (Road, Junction, RoadSignal, RoadMark).
 *
 * External plugins or user-defined JSON files can contribute templates by
 * conforming to these interfaces.
 */

// ── Lane & Mark Config ───────────────────────────────────────────────────────

/** Declarative road-mark specification */
export interface MarkConfig {
  /** Mark line type: 'Solid' | 'Broken' | 'SolidSolid' | 'None' | 'Curb' */
  type: string;
  /** Mark color: 'Standard' (white) | 'Yellow'. Defaults to 'Standard' */
  color?: string;
  /** Mark width in metres. Defaults to 0.15 for solid, 0.12 for broken */
  width?: number;
  /** Weight: 'Standard' | 'Bold'. Defaults to 'Standard' */
  weight?: string;
  /** Lane-change permission: 'None' | 'Both' | 'Increase' | 'Decrease'. Defaults to 'None' */
  laneChange?: string;
}

/** A single lane within a road section config */
export interface LaneConfig {
  /** Lane type: 'Driving' | 'Shoulder' | 'Sidewalk' | 'Parking' | 'Median' | 'Border' */
  laneType: string;
  /** Lane width in metres */
  width: number;
  /** Road mark on the outer edge of this lane. Omit for no mark. */
  mark?: MarkConfig;
}

/** Reusable road cross-section (left + right lanes) */
export interface SectionConfig {
  left: LaneConfig[];
  right: LaneConfig[];
}

// ── Road Template ────────────────────────────────────────────────────────────

export interface RoadTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** Road length in metres. Defaults to 100 */
  length?: number;
  /** Left-side lanes (positive IDs, ordered from center outward) */
  left: LaneConfig[];
  /** Right-side lanes (negative IDs, ordered from center outward) */
  right: LaneConfig[];
}

// ── Junction Template ────────────────────────────────────────────────────────

export type JunctionTopology =
  | 'T'          // 3-arm T-shape (east, west, north)
  | 'Cross'      // 4-arm orthogonal (east, west, north, south)
  | 'Radial'     // N arms equally spaced
  | 'Roundabout'; // N arms equally spaced (placeholder, same geometry for now)

export type ConnectionPattern =
  | 'all-pairs'  // Every pair of arms in both directions: N*(N-1) connections
  | 'none';      // No connections (legacy behaviour)

export interface JunctionTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** Junction shape/layout */
  topology: JunctionTopology;
  /** Number of arms (ignored for 'T'=3 and 'Cross'=4) */
  armCount?: number;
  /** Arm road length in metres (gap from center is computed automatically and is additional) */
  armLength: number;
  /** Cross-section applied to each arm road. Defaults to dual-2-lane driving. */
  armSection?: SectionConfig;
  /** How junction connections are generated. Defaults to 'all-pairs'. */
  connectionPattern?: ConnectionPattern;
  /** Junction display name. Defaults to '' */
  name?: string;
  /** Roundabout: radius of the circular ring road in metres. Defaults to 15. */
  roundaboutRadius?: number;
  roundaboutArcCount?: number;
}

// ── Signal Template ──────────────────────────────────────────────────────────

export interface SignalTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** OpenDRIVE signal type code (e.g. '1000001', '206') */
  signalType: string;
  /** Signal subtype. Defaults to '-1' */
  signalSubtype?: string;
  /** Signal width. Defaults to 1.0 */
  width?: number;
  /** Signal height. Defaults to 2.0 */
  height?: number;
}

// ── Marking Template ─────────────────────────────────────────────────────────

export interface MarkingTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** Mark applied to all driving lanes */
  mark: MarkConfig;
}

// ── Road Object Template ─────────────────────────────────────────────────────

/** All ObjectType keys that can be placed via a template */
export type RoadObjectTypeKey =
  | 'Crosswalk'
  | 'StopLine'
  | 'SlowDownToYieldLine'
  | 'StopToYieldLine'
  | 'CrossHatchArea'
  | 'WovenArea'
  | 'ForwardWaitingArea'
  | 'TurnLeftWaitingArea'
  | 'ParkingSpace'
  | 'Guardrail'
  | 'Barrier'
  | 'TrafficCone'
  | 'StreetLightPole';

export interface RoadObjectTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** Maps to Rust ObjectType (serialised as plain string) */
  objectType: RoadObjectTypeKey;
  /** Default object width in metres */
  defaultWidth?: number;
  /** Default object length in metres */
  defaultLength?: number;
  /** Default object height in metres */
  defaultHeight?: number;
}

// ── Sign Template ─────────────────────────────────────────────────────────────

export type SignTypeKey =
  | 'Sign'
  | 'SignGantry'
  | 'SimpleSignalPole'
  | 'TrafficLightPole'
  | 'LTypeSignalPole';

export interface SignTemplateConfig {
  id: string;
  labelKey: string;
  icon: string;
  /** Maps to Rust ObjectType (serialised as plain string) */
  objectType: SignTypeKey;
  /** Default sign width in metres */
  defaultWidth?: number;
  /** Default sign height in metres */
  defaultHeight?: number;
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export interface TemplateCatalog {
  /** Schema version for forward compatibility */
  version: string;
  roads: RoadTemplateConfig[];
  junctions: JunctionTemplateConfig[];
  signals: SignalTemplateConfig[];
  markings: MarkingTemplateConfig[];
  /** Road surface and roadside accessories (人行横道, 护栏, 停车位…) */
  objects: RoadObjectTemplateConfig[];
  /** Sign structures (标志牌, 信号灯杆…) */
  signs: SignTemplateConfig[];
}
