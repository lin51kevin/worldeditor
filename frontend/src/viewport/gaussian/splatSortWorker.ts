/**
 * Web Worker that depth-sorts Gaussian splats off the main thread.
 *
 * Protocol:
 * - `{ type: "init", positions }` — store the splat positions once (transferable).
 * - `{ type: "sort", camPos, viewDir, generation, frustum? }` — sort against
 *   the given camera (optionally frustum-culling off-screen splats); replies
 *   `{ type: "sorted", indices, visibleCount, generation }` (indices buffer is
 *   transferred back).
 */
import {
  prepareSplatSort,
  sortSplatsByDepth,
  type PreparedSplatSort,
  type Vec3,
} from './splatSort';

type InitMessage = { type: 'init'; positions: Float32Array };
type SortMessage = {
  type: 'sort';
  camPos: Vec3;
  viewDir: Vec3;
  generation: number;
  frustum?: Float32Array | null;
};
type InMessage = InitMessage | SortMessage;

let positions: Float32Array = new Float32Array(0);
let prepared: PreparedSplatSort = prepareSplatSort(positions);

const ctx = self as unknown as Worker;

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    positions = msg.positions;
    prepared = prepareSplatSort(positions);
    return;
  }
  if (msg.type === 'sort') {
    const { indices, visibleCount } = sortSplatsByDepth(
      positions,
      msg.camPos,
      msg.viewDir,
      prepared,
      msg.frustum,
    );
    ctx.postMessage({ type: 'sorted', indices, visibleCount, generation: msg.generation }, [
      indices.buffer,
    ]);
  }
};
