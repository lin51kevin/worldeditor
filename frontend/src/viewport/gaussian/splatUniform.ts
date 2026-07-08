/**
 * CPU-side uniform packing for the Gaussian splat pipeline.
 *
 * The vertex shader needs both the depth-corrected view-projection (for clip
 * position + reverse-Z depth so splats are occluded by opaque geometry) and the
 * raw view matrix (to transform each splat's mean and 3D covariance into eye
 * space for the EWA 2D projection). Focal length (pixels) and viewport size
 * complete the screen-space Jacobian.
 */
import { lookAtMatrix } from "../viewportMath";
import { buildViewProjMatrix } from "../cameraProjection";
import type { CameraState } from "../cameraController";

/**
 * Uniform layout (std140, 176 bytes / 44 floats):
 * ```
 * [ 0..16) view_proj : mat4x4  (depth-corrected)
 * [16..32) view      : mat4x4  (look-at)
 * [32..35) cam_pos   : vec3
 * [35]     sh_degree : f32
 * [36..38) focal     : vec2 (fx, fy) pixels
 * [38..40) viewport  : vec2 (w, h)
 * [40]     dilation  : f32  (2D low-pass filter, px²)
 * [41..44) _pad
 * ```
 */
export const SPLAT_UNIFORM_FLOATS = 44;
/** Byte size of the splat uniform buffer. */
export const SPLAT_UNIFORM_BYTES = SPLAT_UNIFORM_FLOATS * 4;

/** Pixel focal length for a symmetric perspective: `(height/2) / tan(fovY/2)`. */
export function splatFocal(fovY: number, height: number): number {
  return height / 2 / Math.tan(fovY / 2);
}

/** Pack the splat camera uniform for the current frame. */
export function buildSplatUniform(
  camera: CameraState,
  dimensionMode: "2d" | "3d",
  numPixelsPerMeter: number,
  width: number,
  height: number,
  shDegree: number,
  dilation = 0.3,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(SPLAT_UNIFORM_FLOATS);
  const viewProj = buildViewProjMatrix(
    camera,
    dimensionMode,
    numPixelsPerMeter,
    width,
    height,
  );
  const view = lookAtMatrix(camera.position, camera.target, camera.up);
  out.set(viewProj, 0);
  out.set(view, 16);
  out[32] = camera.position[0];
  out[33] = camera.position[1];
  out[34] = camera.position[2];
  out[35] = shDegree;
  const f = splatFocal(camera.fovY, height);
  out[36] = f;
  out[37] = f;
  out[38] = width;
  out[39] = height;
  out[40] = dilation;
  return out;
}
