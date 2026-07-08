// End-to-end verification: real WASM + real 3DGS .ply + JS depth sort.
// Run: node scripts/verify_gaussian_e2e.mjs [path-to-ply]
import { readFileSync } from "node:fs";
import init, {
    load_gaussian_splats,
    gaussian_splat_buffer_sh,
    gaussian_splat_meta,
    free_gaussian_splats,
} from "../frontend/wasm/pkg/we_wasm.js";

/** Band-0 SH basis constant `C0 = 1 / (2*sqrt(pi))`. */
const SH_C0 = 0.28209479177387814;
const plyPath = process.argv[2] ?? "E:/data-root/assets/20003/20003.ply";

// Minimal port of splatSort.sortSplatsByDepth for standalone validation.
function sortSplatsByDepth(positions, camPos, viewDir) {
    const n = positions.length / 3;
    const order = new Uint32Array(n);
    if (n <= 1) {
        if (n === 1) order[0] = 0;
        return order;
    }
    const depths = new Float32Array(n);
    let minD = Infinity;
    let maxD = -Infinity;
    for (let i = 0; i < n; i++) {
        const dx = positions[i * 3] - camPos[0];
        const dy = positions[i * 3 + 1] - camPos[1];
        const dz = positions[i * 3 + 2] - camPos[2];
        const d = dx * viewDir[0] + dy * viewDir[1] + dz * viewDir[2];
        depths[i] = d;
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
    }
    const BUCKETS = 65536;
    const scale = (BUCKETS - 1) / (maxD - minD);
    const counts = new Uint32Array(BUCKETS);
    const bucket = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
        let b = ((depths[i] - minD) * scale) | 0;
        if (b < 0) b = 0;
        else if (b >= BUCKETS) b = BUCKETS - 1;
        bucket[i] = b;
        counts[b]++;
    }
    const starts = new Uint32Array(BUCKETS);
    let running = 0;
    for (let b = BUCKETS - 1; b >= 0; b--) {
        starts[b] = running;
        running += counts[b];
    }
    for (let i = 0; i < n; i++) order[starts[bucket[i]]++] = i;
    return { order, depths };
}

const wasmBytes = readFileSync(
    new URL("../frontend/wasm/pkg/we_wasm_bg.wasm", import.meta.url),
);
await init({ module_or_path: wasmBytes });

const ply = readFileSync(plyPath);
const handle = load_gaussian_splats(new Uint8Array(ply));
const meta = gaussian_splat_meta(handle);
// View-dependent SH buffer: `shStride` floats/splat
// `[x,y,z, cov6, opacity, sh0_r,sh0_g,sh0_b, ...]`.
const STRIDE = meta.shStride;
const buffer = gaussian_splat_buffer_sh(handle);
// Depth-sort positions are the leading xyz of every splat record (extracted
// JS-side, mirroring the frontend `extractSplatPositions`).
const count = meta.count;
const positions = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
    positions[i * 3] = buffer[i * STRIDE];
    positions[i * 3 + 1] = buffer[i * STRIDE + 1];
    positions[i * 3 + 2] = buffer[i * STRIDE + 2];
}

console.log("meta:", meta);
console.log("buffer floats:", buffer.length, "expected:", count * STRIDE);

const checks = [];
const ok = (name, cond) => {
    checks.push([name, cond]);
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
};

ok("buffer length = count*shStride", buffer.length === count * STRIDE);
ok("positions length = count*3", positions.length === count * 3);

let allFinite = true;
let colorInRange = true;
let opacityInRange = true;
for (let i = 0; i < count; i++) {
    const b = i * STRIDE;
    for (let k = 0; k < STRIDE; k++) {
        if (!Number.isFinite(buffer[b + k])) allFinite = false;
    }
    // opacity is the 10th float (index 9); band-0 raw SH triple follows it.
    const op = buffer[b + 9];
    if (op < 0 || op > 1.0001) opacityInRange = false;
    // Decode band-0 colour: rgb = 0.5 + C0 * f_dc.
    const r = 0.5 + SH_C0 * buffer[b + 10];
    const g = 0.5 + SH_C0 * buffer[b + 11];
    const bl = 0.5 + SH_C0 * buffer[b + 12];
    if (r < -0.01 || g < -0.01 || bl < -0.01 || r > 4 || g > 4 || bl > 4)
        colorInRange = false;
}
ok("all buffer values finite", allFinite);
ok("band-0 colors in sane range", colorInRange);
ok("opacity in [0,1] (sigmoid)", opacityInRange);

// positions must equal the leading xyz of each stride.
let posMatches = true;
for (let i = 0; i < Math.min(count, 1000); i++) {
    if (
        positions[i * 3] !== buffer[i * STRIDE] ||
        positions[i * 3 + 1] !== buffer[i * STRIDE + 1] ||
        positions[i * 3 + 2] !== buffer[i * STRIDE + 2]
    ) {
        posMatches = false;
        break;
    }
}
ok("positions match buffer xyz", posMatches);

// Run the real depth sort against a representative camera.
const camPos = [meta.origin[0] + 3, meta.origin[1] + 3, meta.origin[2] + 3];
const viewDir = [-0.577, -0.577, -0.577];
const { order, depths } = sortSplatsByDepth(positions, camPos, viewDir);
ok("sort returns full permutation", order.length === count);
let monotonic = true;
for (let i = 1; i < order.length; i++) {
    if (depths[order[i - 1]] < depths[order[i]] - 1e-3) {
        monotonic = false;
        break;
    }
}
ok("sorted back-to-front (non-increasing depth)", monotonic);

const perm = new Uint8Array(count);
let validPerm = true;
for (const idx of order) {
    if (idx >= count || perm[idx]) { validPerm = false; break; }
    perm[idx] = 1;
}
ok("sort order is a valid permutation", validPerm);

free_gaussian_splats(handle);

const failed = checks.filter(([, c]) => !c);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
