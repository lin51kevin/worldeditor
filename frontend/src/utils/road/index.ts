/**
 * Road manipulation utilities — barrel re-exports.
 *
 * This module re-exports all public APIs from the split sub-modules
 * so existing consumers can continue importing from '../utils/road'.
 */

// Geometry operations
export {
  evalGeometryAtS,
  distanceSquared,
  normalizeAngle,
  angleDelta,
  reverseGeometryType,
  needsResampledReverse,
  splitGeometryType,
  refineClosestDs,
  evalWidthPolyAt,
} from './geometryOps';

// Lane operations
export {
  makeMark,
  makeSidewalkLane,
  cloneLaneWithMirroredId,
  reverseLaneSection,
  getLaneSignature,
  evalLaneSectionAtOffset,
} from './laneOps';

// Station record operations
export {
  clampStation,
  dedupeStationRecords,
  capStationRecords,
  capStationRangeRecords,
  capLateralProfile,
  capRoadObjects,
  buildSampleStations,
  offsetStationRecords,
  offsetStationRangeRecords,
  offsetRoadObjects,
  combineLateralProfile,
  reverseStationRecords,
  reverseStationRangeRecords,
  reverseLaneSections,
  reverseRoadObjects,
} from './stationRecordOps';

// Deployment utilities
export {
  deploySidewalks,
  applyStandardMarkings,
  deployCrosswalks,
  deployStopLines,
} from './deployUtils';

// Road-level operations
export {
  evalRoadAtS,
  resampleRoad,
  findClosestSOnRoad,
  splitRoadAt,
  weldRoads,
} from './roadEdit';
export type { WeldOptions } from './roadEdit';
