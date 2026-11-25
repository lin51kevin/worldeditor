import { describe, it, expect } from "vitest";
import { isSplatFrustumCulled, isSplatThinned, splatScreenSize, SPLAT_FRUSTUM_CULL_WGSL } from "./splatCulling";
import { buildSplatUniform } from "./splatUniform";
import type { CameraState } from "../cameraController";

const camera = {
  position: [3, -12, 6],
  target: [0, 0, 1],
  up: [0, 0, 1],
  fovY: Math.PI / 3,
  near: 0.1,
  far: 2000,
} as CameraState;

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Vec3 = [number, number, number];

function mulMat4(m: Float32Array, offset: number, v: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i]! += m[offset + j * 4 + i]! * (j < 3 ? v[j]! : 1);
    }
  }
  return out;
}

/** Same quaternion -> covariance reconstruction as the splat vertex shader. */
function covariance(scale: Vec3, q: [number, number, number, number]): number[][] {
  const n = Math.hypot(...q);
  const [w, x, y, z] = q.map((c) => c / n) as [number, number, number, number];
  const cols = [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
  const v = [0, 1, 2].map(() => [0, 0, 0]);
  for (let k = 0; k < 3; k++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) v[r]![c]! += scale[k]! ** 2 * cols[k]![r]! * cols[k]![c]!;
    }
  }
  return v;
}

/**
 * The shader's exact screen footprint (EWA ellipse) for a splat: returns the
 * NDC centre and the per-axis NDC half-extent of its quad, or null when the
 * shader itself would drop the splat.
 */
function exactFootprint(
  u: Float32Array,
  pos: Vec3,
  scale: Vec3,
  quat: [number, number, number, number],
  opacity: number,
): { ndc: [number, number]; radius: [number, number] } | null {
  const cam = mulMat4(u, 16, pos);
  const clip = mulMat4(u, 0, pos);
  const depth = -cam[2]!;
  if (depth <= 1e-6 || clip[3]! <= 1e-6) return null;
  const fx = u[36]!;
  const fy = u[37]!;
  const perspective = u[42]! < 0.5;
  const j = perspective
    ? [
        [fx / depth, 0, (fx * cam[0]!) / (depth * depth)],
        [0, fy / depth, (fy * cam[1]!) / (depth * depth)],
      ]
    : [
        [fx, 0, 0],
        [0, fy, 0],
      ];
  // W = upper-left 3x3 of the view matrix; T = Wᵀ·Jᵀ in the shader's column layout.
  const w = [0, 1, 2].map((r) => [0, 1, 2].map((c) => u[16 + c * 4 + r]!));
  const t = [0, 1, 2].map((r) => [0, 1].map((c) => [0, 1, 2].reduce((s, k) => s + w[k]![r]! * j[c]![k]!, 0)));
  const vrk = covariance(scale, quat);
  const cov = [0, 1].map((a) =>
    [0, 1].map((b) => {
      let s = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += t[r]![a]! * vrk[r]![c]! * t[c]![b]!;
      return s;
    }),
  );
  const dilation = u[40]!;
  const a = cov[0]![0]! + dilation;
  const bc = cov[0]![1]!;
  const cc = cov[1]![1]! + dilation;
  const mid = 0.5 * (a + cc);
  const disc = Math.sqrt(Math.max(0, mid * mid - (a * cc - bc * bc)));
  const l1 = mid + disc;
  if (l1 <= 0) return null;
  const l2 = Math.max(0.1, mid - disc);
  let ev: [number, number] = [1, 0];
  if (Math.abs(bc) > 1e-6) {
    const e: [number, number] = [bc, l1 - a];
    const len = Math.hypot(...e);
    ev = [e[0] / len, e[1] / len];
  }
  const EXP4 = 0.01831563889;
  const alphaEdge = EXP4 + (0.00392156862745 * (1 - EXP4)) / opacity;
  const quadRadius = Math.sqrt(Math.min(4, Math.max(0, -Math.log(Math.min(1, Math.max(EXP4, alphaEdge))))));
  const vmin = Math.min(1024, Math.min(u[38]!, u[39]!));
  const r1 = Math.min(Math.sqrt(2 * l1), vmin);
  const r2 = Math.min(Math.sqrt(2 * l2), vmin);
  const major = [ev[0] * r1, ev[1] * r1];
  const minor = [-ev[1] * r2, ev[0] * r2];
  const pixel = [quadRadius * (Math.abs(major[0]!) + Math.abs(minor[0]!)), quadRadius * (Math.abs(major[1]!) + Math.abs(minor[1]!))];
  return {
    ndc: [clip[0]! / clip[3]!, clip[1]! / clip[3]!],
    radius: [pixel[0]! / (u[38]! * 0.5), pixel[1]! / (u[39]! * 0.5)],
  };
}

function intersectsView(f: { ndc: [number, number]; radius: [number, number] }): boolean {
  return !(
    f.ndc[0] + f.radius[0] < -1 ||
    f.ndc[0] - f.radius[0] > 1 ||
    f.ndc[1] + f.radius[1] < -1 ||
    f.ndc[1] - f.radius[1] > 1
  );
}

describe("isSplatFrustumCulled", () => {
  it("culls a splat behind the camera and keeps one at the view centre", () => {
    const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
    expect(isSplatFrustumCulled(u, [3, -12 - 10, 6], 0.1, 0)).toBe(true);
    expect(isSplatFrustumCulled(u, [0, 0, 1], 0.1, 0)).toBe(false);
  });

  it("culls a small splat far outside the side planes", () => {
    const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
    expect(isSplatFrustumCulled(u, [900, 0, 1], 0.05, 0)).toBe(true);
  });

  it("keeps a huge splat whose footprint reaches into view from outside", () => {
    const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
    // Centre is off to the side, but the splat's own footprint still overlaps the screen.
    const pos: Vec3 = [14, 0, 1];
    const exact = exactFootprint(u, pos, [6, 6, 6], [1, 0, 0, 0], 1);
    expect(exact && Math.abs(exact.ndc[0]) > 1 && intersectsView(exact)).toBe(true);
    expect(isSplatFrustumCulled(u, pos, 6, 0)).toBe(false);
  });

  it("guard band keeps splats just outside the frustum", () => {
    const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
    const pos: Vec3 = [0, 0, 1];
    // Walk sideways until the plain test culls it, then confirm a guard band retains it.
    let x = 0;
    while (!isSplatFrustumCulled(u, [x, 0, 1], 0.05, 0) && x < 500) x += 0.5;
    pos[0] = x;
    expect(isSplatFrustumCulled(u, pos, 0.05, 0)).toBe(true);
    expect(isSplatFrustumCulled(u, pos, 0.05, 0.25)).toBe(false);
  });

  it("never culls a splat that the shader's exact footprint would keep (perspective)", () => {
    const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
    const rand = rng(7);
    let checked = 0;
    let culled = 0;
    for (let i = 0; i < 20000; i++) {
      const pos: Vec3 = [(rand() - 0.5) * 300, (rand() - 0.5) * 300, (rand() - 0.5) * 100];
      const scale: Vec3 = [10 ** (rand() * 4 - 3), 10 ** (rand() * 4 - 3), 10 ** (rand() * 4 - 3)];
      const quat: [number, number, number, number] = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const exact = exactFootprint(u, pos, scale, quat, 0.2 + rand() * 0.8);
      const cheap = isSplatFrustumCulled(u, pos, Math.max(...scale), 0);
      if (cheap) culled++;
      if (exact && intersectsView(exact)) {
        checked++;
        expect(cheap, `splat ${i} at ${pos} scale ${scale}`).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(500);
    // The bound must also be tight enough to be useful.
    expect(culled).toBeGreaterThan(5000);
  });

  it("never culls a splat that the shader's exact footprint would keep (orthographic)", () => {
    const u = buildSplatUniform(camera, "2d", 40, 1000, 800, 1);
    const rand = rng(11);
    let checked = 0;
    for (let i = 0; i < 10000; i++) {
      const pos: Vec3 = [(rand() - 0.5) * 80, (rand() - 0.5) * 80, (rand() - 0.5) * 20];
      const scale: Vec3 = [10 ** (rand() * 3 - 2), 10 ** (rand() * 3 - 2), 10 ** (rand() * 3 - 2)];
      const quat: [number, number, number, number] = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const exact = exactFootprint(u, pos, scale, quat, 0.5 + rand() * 0.5);
      if (exact && intersectsView(exact)) {
        checked++;
        expect(isSplatFrustumCulled(u, pos, Math.max(...scale), 0), `splat ${i}`).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("SPLAT_FRUSTUM_CULL_WGSL", () => {
  it("declares the helper the sort shader calls", () => {
    expect(SPLAT_FRUSTUM_CULL_WGSL).toContain("fn splat_frustum_culled");
  });
});

describe("isSplatThinned", () => {
  const u = buildSplatUniform(camera, "3d", 50, 1280, 720, 1);
  const pos: [number, number, number] = [0, 0, 1];

  /** On-screen size proxy the key pass compares against tau: smax · ‖J‖F. */
  function sizePx(smax: number): number {
    return splatScreenSize(u, pos, smax);
  }

  it("never thins when the threshold is zero", () => {
    for (let i = 0; i < 2000; i++) expect(isSplatThinned(u, i, pos, 0.001, 0)).toBe(false);
  });

  it("always keeps splats at least as large as the threshold", () => {
    const smax = 0.5;
    const tau = sizePx(smax) * 0.99;
    for (let i = 0; i < 2000; i++) expect(isSplatThinned(u, i, pos, smax, tau)).toBe(false);
  });

  it("keeps a smaller splat with probability (size/tau)², independent of the camera", () => {
    const tau = 8;
    // Pick a scale whose size is tau/2 => keep probability 0.25.
    let smax = 0.01;
    while (sizePx(smax) < tau / 2) smax *= 1.05;
    let kept = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) if (!isSplatThinned(u, i, pos, smax, tau)) kept++;
    expect(kept / n).toBeGreaterThan(0.2);
    expect(kept / n).toBeLessThan(0.3);
  });

  it("decides per splat index, so the same splat is kept or dropped on every frame", () => {
    let smax = 0.01;
    while (sizePx(smax) < 5) smax *= 1.05;
    const a = Array.from({ length: 500 }, (_, i) => isSplatThinned(u, i, pos, smax, 10));
    const b = Array.from({ length: 500 }, (_, i) => isSplatThinned(u, i, pos, smax, 10));
    expect(a).toEqual(b);
    expect(a.some(Boolean) && a.some((x) => !x)).toBe(true);
  });

  it("declares the helper the sort shader calls", () => {
    expect(SPLAT_FRUSTUM_CULL_WGSL).toContain("fn splat_thinned");
  });
});
