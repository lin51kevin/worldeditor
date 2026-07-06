/**
 * NPC-actor manual verification helper.
 *
 * Produces a small, deterministic set of sample actors + a trajectory so the
 * box/ribbon rendering (and its coexistence with the WASM-generated road
 * surface) can be verified by eye in any host — the standalone worldeditor-next
 * app or the embedded case editor. Kept in the plugin so the sample data and
 * the render wiring stay independent and testable.
 */

import { buildBoxVertices, buildPathVertices } from './actorGeometry';
import { CaseActorBox } from './actorTypes';

/** Minimal renderer surface the verification helper needs. */
export interface DebugActorTarget {
  setDimension(dimension: '2d' | '3d'): void;
  uploadActorVertices(vertexData: Float32Array): void;
  uploadPathVertices(vertexData: Float32Array): void;
  /** World-space ground point at the viewport center (for placement). */
  getGroundCenter(): { x: number; y: number } | null;
  render(): void;
}

/** Trajectory ribbon half-width for the sample, meters. */
const SAMPLE_PATH_HALF_WIDTH = 0.25;

/**
 * Build a representative set of sample boxes centered at (cx, cy): an ego, an
 * opponent car, a pedestrian, and three waypoint handles (one selected).
 */
export function buildSampleActors(cx: number, cy: number): CaseActorBox[] {
  const boxes: CaseActorBox[] = [
    {
      id: 'dbg:ego',
      kind: 'element',
      position: [cx - 8, cy, 0.75],
      heading: 0,
      size: [4.5, 2, 1.5],
      color: [0.2, 0.62, 0.3, 1],
      selected: true,
    },
    {
      id: 'dbg:car',
      kind: 'element',
      position: [cx, cy, 0.8],
      heading: 0,
      size: [4, 2, 1.6],
      color: [0.2, 0.78, 0.32, 1],
    },
    {
      id: 'dbg:ped',
      kind: 'element',
      position: [cx + 4, cy + 3, 0.9],
      heading: Math.PI / 4,
      size: [0.6, 0.6, 1.8],
      color: [0.25, 0.85, 0.35, 1],
    },
  ];
  for (let i = 1; i <= 3; i++) {
    boxes.push({
      id: `dbg:wp:${i}`,
      kind: 'waypoint',
      position: [cx + i * 6, cy, 0.3],
      heading: 0,
      size: [0.6, 0.6, 0.6],
      color: [0.95, 0.85, 0.2, 1],
      selected: i === 2,
    });
  }
  return boxes;
}

/**
 * Build a straight sample trajectory from (cx, cy) to (cx + 18, cy) as flat
 * segment pairs (14 floats per segment: 2 × xyz+rgba).
 */
export function buildSampleSegments(cx: number, cy: number): Float32Array {
  const steps = 6;
  const z = 0.15;
  const color: [number, number, number, number] = [0.2, 0.85, 0.9, 1];
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const x0 = cx + (18 * i) / steps;
    const x1 = cx + (18 * (i + 1)) / steps;
    out.push(x0, cy, z, ...color, x1, cy, z, ...color);
  }
  return new Float32Array(out);
}

/** Switch to 3D and upload the sample actors + trajectory at the viewport center. */
export function spawnSampleActors(target: DebugActorTarget): void {
  const center = target.getGroundCenter() ?? { x: 0, y: 0 };
  target.setDimension('3d');
  target.uploadActorVertices(buildBoxVertices(buildSampleActors(center.x, center.y)));
  target.uploadPathVertices(buildPathVertices(buildSampleSegments(center.x, center.y), SAMPLE_PATH_HALF_WIDTH));
  target.render();
}

/** Remove all sample actors + trajectory. */
export function clearSampleActors(target: DebugActorTarget): void {
  target.uploadActorVertices(new Float32Array(0));
  target.uploadPathVertices(new Float32Array(0));
  target.render();
}
