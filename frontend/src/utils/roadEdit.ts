/**
 * Pure road manipulation utilities.
 *
 * This file is now a re-export shim. The actual implementation has been
 * split into focused modules under ./road/ for better maintainability.
 *
 * @see ./road/geometryOps.ts     — Geometry evaluation & manipulation
 * @see ./road/laneOps.ts         — Lane-level operations
 * @see ./road/stationRecordOps.ts — Station record manipulation
 * @see ./road/deployUtils.ts     — Sidewalk/marking/crosswalk/stopline deployment
 * @see ./road/roadEdit.ts        — Road split/weld/reverse/resample
 */

export {
  evalRoadAtS,
  resampleRoad,
  findClosestSOnRoad,
  splitRoadAt,
  weldRoads,
  deploySidewalks,
  applyStandardMarkings,
  deployCrosswalks,
  deployStopLines,
} from './road';
export type { WeldOptions } from './road';
