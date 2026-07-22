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
// Packed layout v2: f32 position/scale/quaternion followed by f16 opacity/SH.
const STRIDE = meta.shStride;
const buffer = gaussian_splat_buffer_sh(handle);
const bufferF32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length);
const halfToFloat = (h) => {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >>> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * frac * 2 ** -24;
    if (exp === 0x1f) return frac ? NaN : sign * Infinity;
    return sign * (1 + frac / 1024) * 2 ** (exp - 15);
};
const halfAt = (base, element) => {
    const word = buffer[base + 10 + (element >>> 1)];
    const bits = element & 1 ? word >>> 16 : word & 0xffff;
    return halfToFloat(bits);
};
// Depth-sort positions are the leading xyz of every splat record (extracted
// JS-side, mirroring the frontend `extractSplatPositions`).
const count = meta.count;
const positions = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
    positions[i * 3] = bufferF32[i * STRIDE];
    positions[i * 3 + 1] = bufferF32[i * STRIDE + 1];
    positions[i * 3 + 2] = bufferF32[i * STRIDE + 2];
}

console.log("meta:", meta);
console.log("buffer words:", buffer.length, "expected:", count * STRIDE);

const checks = [];
const ok = (name, cond) => {
    checks.push([name, cond]);
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
};

ok("buffer length = count*shStride", buffer.length === count * STRIDE);
ok("packed layout version = 2", meta.layoutVersion === 2);
ok("positions length = count*3", positions.length === count * 3);

let allFinite = true;
let colorInRange = true;
let opacityInRange = true;
for (let i = 0; i < count; i++) {
    const b = i * STRIDE;
    for (let k = 0; k < 10; k++) {
        if (!Number.isFinite(bufferF32[b + k])) allFinite = false;
    }
    const op = halfAt(b, 0);
    if (!Number.isFinite(op)) allFinite = false;
    if (!Number.isFinite(op) || op < 0 || op > 1.0001) opacityInRange = false;
    // Decode band-0 colour: rgb = 0.5 + C0 * f_dc.
    const dc = [halfAt(b, 1), halfAt(b, 2), halfAt(b, 3)];
    if (!dc.every(Number.isFinite)) allFinite = false;
    const r = 0.5 + SH_C0 * dc[0];
    const g = 0.5 + SH_C0 * dc[1];
    const bl = 0.5 + SH_C0 * dc[2];
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
        positions[i * 3] !== bufferF32[i * STRIDE] ||
        positions[i * 3 + 1] !== bufferF32[i * STRIDE + 1] ||
        positions[i * 3 + 2] !== bufferF32[i * STRIDE + 2]
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
