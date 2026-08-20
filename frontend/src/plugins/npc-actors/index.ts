/**
 * NPC-actors plugin — public entry.
 *
 * A self-contained module that renders scenario actors as oriented bounding
 * boxes plus trajectory ribbons and resolves ground picking against them.
 * Consumed by the viewport/SDK integration; has no WebGPU dependency itself.
 */

export { CaseActorLayer } from './actorLayer';
export { buildBoxVertices, buildPathVertices } from './actorGeometry';
export { pickActorAt, pickActorAtScreen } from './actorPicker';
export type { CaseActorBox, Rgba } from './actorTypes';
export { ACTOR_VERTEX_STRIDE } from './actorTypes';
export {
  spawnSampleActors,
  clearSampleActors,
  buildSampleActors,
  buildSampleSegments,
} from './actorDebug';
export type { DebugActorTarget } from './actorDebug';
export {
  openTrajFile,
  clearTraj,
  playTraj,
  parseTraj,
  buildTrajBoxes,
  buildEgoBox,
  buildTrajSegments,
  trajFrames,
  trajBounds,
  trajTimeSpan,
  interpPose,
  isEntityActiveAt,
  getEntityInfoAt,
  PATH_HALF_WIDTH,
  PATH_Z,
} from './trajViewer';
export type { TrajViewerTarget, TrajData, BuildTrajBoxesOptions, TrajActorInfo } from './trajViewer';
export { parsePlyFirstVertex } from './plyOrigin';
