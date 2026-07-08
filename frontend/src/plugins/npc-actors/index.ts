/**
 * NPC-actors plugin — public entry.
 *
 * A self-contained module that renders scenario actors as oriented bounding
 * boxes plus trajectory ribbons and resolves ground picking against them.
 * Consumed by the viewport/SDK integration; has no WebGPU dependency itself.
 */

export { CaseActorLayer } from './actorLayer';
export { buildBoxVertices, buildPathVertices } from './actorGeometry';
export { pickActorAt } from './actorPicker';
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
  buildTrajSegments,
} from './trajViewer';
export type { TrajViewerTarget, TrajData } from './trajViewer';
export { parsePlyFirstVertex } from './plyOrigin';
