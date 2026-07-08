/**
 * Web Worker that depth-sorts Gaussian splats off the main thread.
 *
 * Protocol:
 * - `{ type: "init", positions }` — store the splat positions once (transferable).
 * - `{ type: "sort", camPos, viewDir, generation }` — sort against the given
 *   camera; replies `{ type: "sorted", indices, generation }` (indices buffer
 *   is transferred back).
 */
import { sortSplatsByDepth, type Vec3 } from "./splatSort";

type InitMessage = { type: "init"; positions: Float32Array };
type SortMessage = {
  type: "sort";
  camPos: Vec3;
  viewDir: Vec3;
  generation: number;
};
type InMessage = InitMessage | SortMessage;

let positions: Float32Array = new Float32Array(0);

const ctx = self as unknown as Worker;

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    positions = msg.positions;
    return;
  }
  if (msg.type === "sort") {
    const indices = sortSplatsByDepth(positions, msg.camPos, msg.viewDir);
    ctx.postMessage(
      { type: "sorted", indices, generation: msg.generation },
      [indices.buffer],
    );
  }
};
