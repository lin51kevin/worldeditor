import { describe, it, expect } from "vitest";
import { isGaussianPly } from "./pointcloudActions";

function bytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

const GAUSSIAN_HEADER = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;

const PLAIN_POINTS_HEADER = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 2 3 0 255 0
`;

describe("isGaussianPly", () => {
  it("detects a 3D Gaussian Splatting PLY header", () => {
    expect(isGaussianPly(bytesOf(GAUSSIAN_HEADER))).toBe(true);
  });

  it("rejects a plain RGB point-cloud PLY", () => {
    expect(isGaussianPly(bytesOf(PLAIN_POINTS_HEADER))).toBe(false);
  });

  it("rejects an empty / non-PLY buffer", () => {
    expect(isGaussianPly(new Uint8Array(0))).toBe(false);
    expect(isGaussianPly(bytesOf("not a ply file"))).toBe(false);
  });

  it("only scans the header, ignoring binary body noise after end_header", () => {
    const withBody = new Uint8Array([
      ...bytesOf(GAUSSIAN_HEADER),
      // Arbitrary binary payload that must not affect detection.
      0x00, 0xff, 0x7f, 0x80, 0x01,
    ]);
    expect(isGaussianPly(withBody)).toBe(true);
  });

  it("detects splat props declared past the old 8 KiB scan cap (desktop parity)", () => {
    // A header padded with comments so the signature properties land beyond
    // 8 KiB — the native probe scans 64 KiB, so web must too.
    const pad = Array.from({ length: 400 }, (_, i) => `comment padding line ${i}`).join("\n");
    const bigHeader = `ply
format binary_little_endian 1.0
${pad}
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float opacity
property float scale_0
property float rot_0
end_header
`;
    expect(bytesOf(bigHeader).length).toBeGreaterThan(8192);
    expect(isGaussianPly(bytesOf(bigHeader))).toBe(true);
  });

  it("matches property names as substrings, mirroring the native probe", () => {
    // Native detection uses substring `contains`; ensure web agrees even when
    // the declaration whitespace/type differs from a strict pattern.
    const header = `ply\ncomment f_dc_0 scale_0 rot_0 opacity present\nelement vertex 1\nproperty double x\nend_header\n`;
    expect(isGaussianPly(bytesOf(header))).toBe(true);
  });
});
