import { mouseButtonMask, resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';
import type { MouseDragAction } from './viewportTypes';
import {
  perspectiveMatrix,
  orthographicMatrix,
  lookAtMatrix,
  multiplyMatrices,
  arraysEqual,
  invertMatrix4,
  transformPoint,
  niceNumber,
} from './viewportMath';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovY: number;
  near: number;
  far: number;
}

export interface ScaleInfo {
  gridSpacing: number;
  mpp: number;
}

const DEPTH_CORRECTION = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0.5, 0,
  0, 0, 0.5, 1,
]);

const MIN_CAM_DIST = 0.5;
const MAX_CAM_DIST = 50000.0;

/** Fly mode: default movement speed in meters per second. */
const DEFAULT_FLY_SPEED = 20;
/** Fly mode: minimum fly speed. */
const MIN_FLY_SPEED = 0.5;
/** Fly mode: maximum fly speed. */
const MAX_FLY_SPEED = 5000;
/** Fly mode: sprint multiplier when Shift is held. */
const FLY_SPRINT_MULTIPLIER = 3.0;
/** Fly mode: mouse sensitivity for yaw/pitch. */
const FLY_LOOK_SENSITIVITY = 0.003;
/** Fly mode: maximum pitch angle (radians, slightly less than 90°). */
const FLY_MAX_PITCH = Math.PI / 2 - 0.01;

/** 2D mode: fixed camera height above target (same as C# version). */
const ORTHO_CAM_HEIGHT = 10000;
/** 2D mode: minimum pixels per meter (fully zoomed out — shows huge area). */
const MINIMAL_SCALE = 0.0625 / 256;
/** 2D mode: maximum pixels per meter (fully zoomed in — shows tiny area). */
const MAXIMAL_SCALE = 256;
/** 2D mode: default pixels per meter. */
const DEFAULT_SCALE = 1;
/** Target grid cell size in screen pixels (same as C# GridSizePerSquare). */
const GRID_TARGET_PX = 50;

/** Camera state, transforms, and orbit/pan/zoom input handling for the viewport. */
export class CameraController {
  private camera: CameraState = {
    position: [0, -80, 60],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fovY: Math.PI / 4,
    near: 0.1,
    far: 100000,
  };

  private _animatingDimension = false;
  private _animStartPos: [number, number, number] = [0, 0, 0];
  private _animEndPos: [number, number, number] = [0, 0, 0];
  private _animStartUp: [number, number, number] = [0, 0, 0];
  private _animEndUp: [number, number, number] = [0, 0, 0];
  private _animDuration = 400;

  private width = 0;
  private height = 0;
  private isDragging = false;
  private activeMouseButton: number | null = null;
  private activeDragAction: MouseDragAction | null = null;
  private lastMouse: [number, number] = [0, 0];
  private cameraLocked = false;
  private dimensionMode: '3d' | '2d' = '3d';
  private cachedViewProj: Float32Array | null = null;
  private cachedInverseViewProj: Float32Array | null = null;
  private viewDirty = true;
  private cachedViewProjForRender: Float32Array | null = null;
  private onScaleChange: ((info: ScaleInfo) => void) | null = null;
  private onScaleMetricsChanged: ((info: ScaleInfo) => void) | null = null;
  /** Callback invoked every time viewDirty is set to true. Used to wake the render loop. */
  private onViewBecameDirty: (() => void) | null = null;
  private lastReportedMpp = -1;
  private lastReportedGridSpacing = -1;

  /** 2D mode: pixels per meter (controls zoom level in orthographic projection). */
  private numPixelsPerMeter = DEFAULT_SCALE;
  /** 2D pan: mouse position at drag start. */
  private panStartMouse: [number, number] = [0, 0];
  /** 2D pan: camera target at drag start. */
  private panStartTarget: [number, number, number] = [0, 0, 0];
  /** 2D pan: camera position at drag start. */
  private panStartPosition: [number, number, number] = [0, 0, 0];

  /** Fly mode: whether the camera is in free-roaming fly mode. */
  private _flyMode = false;
  /** Fly mode: yaw angle in radians (horizontal rotation around Z axis). */
  private _flyYaw = 0;
  /** Fly mode: pitch angle in radians (vertical tilt, positive = looking up). */
  private _flyPitch = 0;
  /** Fly mode: movement speed in meters per second. */
  private _flySpeed = DEFAULT_FLY_SPEED;

  get state(): Readonly<CameraState> {
    return this.camera;
  }

  resetCamera(dimension?: '2d' | '3d'): void {
    const targetDim = dimension ?? this.dimensionMode;
    if (targetDim === '2d') {
      this.camera = {
        position: [0, 0, ORTHO_CAM_HEIGHT],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fovY: Math.PI / 4,
        near: 0.1,
        far: 100000,
      };
      this.dimensionMode = '2d';
    } else {
      this.camera = {
        position: [0, -80, 60],
        target: [0, 0, 0],
        up: [0, 0, 1],
        fovY: Math.PI / 4,
        near: 0.1,
        far: 100000,
      };
      this.dimensionMode = '3d';
    }
    this.numPixelsPerMeter = DEFAULT_SCALE;
    this._animatingDimension = false;
    this.cachedViewProj = null;
    this.cachedInverseViewProj = null;
    this.viewDirty = true;
    this.onViewBecameDirty?.();
  }

  get isViewDirty(): boolean {
    return this.viewDirty;
  }
  set isViewDirty(v: boolean) {
    this.viewDirty = v;
  }

  get pointerDragging(): boolean {
    return this.isDragging;
  }

  get locked(): boolean {
    return this.cameraLocked;
  }

  get dimension(): '3d' | '2d' {
    return this.dimensionMode;
  }

  get currentGridSpacing(): number {
    // Dynamic grid spacing: adapts to current zoom level so grid cells are ~50px on screen
    const mpp = this.getMetersPerPixel();
    return niceNumber(Math.max(GRID_TARGET_PX * mpp, 0.01));
  }

  setScaleChangeCallback(cb: ((info: ScaleInfo) => void) | null): void {
    this.onScaleChange = cb;
    this.reportScale();
  }

  setScaleMetricsChangedCallback(cb: ((info: ScaleInfo) => void) | null): void {
    this.onScaleMetricsChanged = cb;
  }

  /** Register a callback called whenever the view becomes dirty (needs re-render). */
  setViewDirtyCallback(cb: (() => void) | null): void {
    this.onViewBecameDirty = cb;
  }

  setViewportSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.viewDirty = true;
    this.onViewBecameDirty?.();
  }

  markDirty(): void {
    this.viewDirty = true;
    this.onViewBecameDirty?.();
  }

  /** Compute current meters-per-pixel. In 2D mode uses numPixelsPerMeter directly. */
  getMetersPerPixel(): number {
    if (this.dimensionMode === '2d') {
      return 1 / this.numPixelsPerMeter;
    }
    const camDist = this.getEffectiveCameraDistance();
    const halfWorldWidth = camDist * Math.tan(this.camera.fovY / 2);
    return (halfWorldWidth * 2) / Math.max(1, this.width);
  }

  reportScale(): void {
    const info = { gridSpacing: this.currentGridSpacing, mpp: this.getMetersPerPixel() };
    if (info.mpp === this.lastReportedMpp && info.gridSpacing === this.lastReportedGridSpacing) return;
    this.lastReportedMpp = info.mpp;
    this.lastReportedGridSpacing = info.gridSpacing;
    this.onScaleChange?.(info);
    this.onScaleMetricsChanged?.(info);
  }

  setDimension(dimension: '3d' | '2d'): void {
    if (dimension === this.dimensionMode) return;
    if (this._animatingDimension) return;

    const [tx, ty, tz] = this.camera.target;

    if (dimension === '2d') {
      // Compute numPixelsPerMeter from current perspective view so that the
      // visible area is approximately the same after switching to ortho.
      const currentMpp = this.getMetersPerPixel();
      this.numPixelsPerMeter = Math.max(MINIMAL_SCALE, Math.min(MAXIMAL_SCALE, 1 / currentMpp));
      this._animEndPos = [tx, ty, tz + ORTHO_CAM_HEIGHT];
      this._animEndUp = [0, 1, 0];
    } else {
      // Switch back to 3D perspective: compute a camera distance from current scale
      const mpp = 1 / this.numPixelsPerMeter;
      const halfWorld = mpp * this.height / 2;
      const perspDist = halfWorld / Math.tan(this.camera.fovY / 2);
      this._animEndPos = [tx, ty - perspDist * 0.6, tz + perspDist * 0.8];
      this._animEndUp = [0, 0, 1];
    }

    this._animStartPos = [...this.camera.position] as [number, number, number];
    this._animStartUp = [...this.camera.up] as [number, number, number];
    this._animatingDimension = true;
    this.dimensionMode = dimension;
    this._startDimensionAnimation();
  }

  private _startDimensionAnimation(): void {
    const startTime = performance.now();
    const step = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / this._animDuration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position = [
        this._animStartPos[0] + (this._animEndPos[0] - this._animStartPos[0]) * ease,
        this._animStartPos[1] + (this._animEndPos[1] - this._animStartPos[1]) * ease,
        this._animStartPos[2] + (this._animEndPos[2] - this._animStartPos[2]) * ease,
      ];
      this.camera.up = [
        this._animStartUp[0] + (this._animEndUp[0] - this._animStartUp[0]) * ease,
        this._animStartUp[1] + (this._animEndUp[1] - this._animStartUp[1]) * ease,
        this._animStartUp[2] + (this._animEndUp[2] - this._animStartUp[2]) * ease,
      ];
      this.viewDirty = true;
      this.onViewBecameDirty?.();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this._animatingDimension = false;
      }
    };
    requestAnimationFrame(step);
  }

  unprojectToGround(screenX: number, screenY: number): { x: number; y: number } | null {
    if (this.width === 0 || this.height === 0) return null;

    const ndcX = (screenX / this.width) * 2 - 1;
    const ndcY = 1 - (screenY / this.height) * 2;
    const viewProj = this.computeViewProj();
    if (!this.cachedViewProj || !arraysEqual(this.cachedViewProj, viewProj)) {
      this.cachedViewProj = new Float32Array(viewProj);
      const inv = invertMatrix4(viewProj);
      if (!inv) return null;
      this.cachedInverseViewProj = inv;
    }
    const inv = this.cachedInverseViewProj;
    if (!inv) return null;

    const nearPt = transformPoint(inv, [ndcX, ndcY, 0]);
    const farPt = transformPoint(inv, [ndcX, ndcY, 1]);
    const dx = farPt[0] - nearPt[0];
    const dy = farPt[1] - nearPt[1];
    const dz = farPt[2] - nearPt[2];
    if (Math.abs(dz) < 1e-10) return null;

    const t = -nearPt[2] / dz;
    if (t < 0) return null;
    return {
      x: nearPt[0] + dx * t,
      y: nearPt[1] + dy * t,
    };
  }

  projectWorldToScreen(wx: number, wy: number): { x: number; y: number } | null {
    if (this.width === 0 || this.height === 0) return null;
    const viewProj = this.computeViewProj();
    const x = wx;
    const y = wy;
    const z = 0;
    const w = 1;
    const px = viewProj[0]! * x + viewProj[4]! * y + viewProj[8]! * z + viewProj[12]! * w;
    const py = viewProj[1]! * x + viewProj[5]! * y + viewProj[9]! * z + viewProj[13]! * w;
    const pw = viewProj[3]! * x + viewProj[7]! * y + viewProj[11]! * z + viewProj[15]! * w;
    if (Math.abs(pw) < 1e-10) return null;

    const ndcX = px / pw;
    const ndcY = py / pw;
    return {
      x: (ndcX + 1) * 0.5 * this.width,
      y: (1 - ndcY) * 0.5 * this.height,
    };
  }

  fitToVertices(vertexData: Float32Array): void {
    // Cancel any in-progress dimension-switch animation so it cannot override
    // the camera position we are about to set (e.g. animation started at app
    // startup against target [0,0,0] while the file loads asynchronously).
    this._animatingDimension = false;

    const stride = 7;
    const count = vertexData.length / stride;
    if (count === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = vertexData[i * stride]!;
      const y = vertexData[i * stride + 1]!;
      const z = vertexData[i * stride + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    const maxExtent = Math.max(extentX, extentY, extentZ, 1);

    this.camera.target = [cx, cy, cz];
    if (this.dimensionMode === '2d') {
      // 2D: orthographic — compute numPixelsPerMeter so that the scene fills ~80% of viewport
      const viewMeters = maxExtent / 0.8;
      const fitScaleH = this.width > 0 ? this.width / viewMeters : DEFAULT_SCALE;
      const fitScaleV = this.height > 0 ? this.height / viewMeters : DEFAULT_SCALE;
      this.numPixelsPerMeter = Math.max(MINIMAL_SCALE, Math.min(MAXIMAL_SCALE, Math.min(fitScaleH, fitScaleV)));
      this.camera.position = [cx, cy, cz + ORTHO_CAM_HEIGHT];
      this.camera.up = [0, 1, 0];
      this.camera.near = 0.1;
      this.camera.far = ORTHO_CAM_HEIGHT * 2 + 100;
    } else {
      const dist = maxExtent * 0.8;
      this.camera.position = [cx, cy - dist * 0.6, cz + dist * 0.8];
      this.camera.up = [0, 0, 1];
      this.camera.near = Math.max(0.1, maxExtent * 0.001);
      this.camera.far = Math.max(100000, maxExtent * 10);
    }
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  panToCenter(vertexData: Float32Array): void {
    const stride = 7;
    const count = vertexData.length / stride;
    if (count === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = vertexData[i * stride]!;
      const y = vertexData[i * stride + 1]!;
      const z = vertexData[i * stride + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const offsetX = px - tx;
    const offsetY = py - ty;
    const offsetZ = pz - tz;

    this.camera.target = [cx, cy, cz];
    this.camera.position = [cx + offsetX, cy + offsetY, cz + offsetZ];
    const camDist = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
    this.camera.near = Math.max(0.1, camDist * 0.001);
    this.camera.far = Math.max(100000, camDist * 100);
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  beginPointerDrag(button: number, event: Pick<MouseEvent, 'clientX' | 'clientY' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
    if (this.cameraLocked) return false;
    const action = resolveMouseDragAction(button, event, this.dimensionMode);
    if (!action) return false;

    // Enter fly mode on right-click in 3D
    if (action === 'fly') {
      this.enterFlyMode();
    }

    this.isDragging = true;
    this.activeMouseButton = button;
    this.activeDragAction = action;
    this.lastMouse = [event.clientX, event.clientY];
    // Store start state for 2D pan (C# style: compute total offset from start)
    if (this.dimensionMode === '2d') {
      this.panStartMouse = [event.clientX, event.clientY];
      this.panStartTarget = [...this.camera.target] as [number, number, number];
      this.panStartPosition = [...this.camera.position] as [number, number, number];
    }
    return true;
  }

  updatePointerDrag(
    canvas: HTMLCanvasElement,
    event: Pick<MouseEvent, 'buttons' | 'clientX' | 'clientY' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  ): boolean {
    if (!this.isDragging || this.activeMouseButton === null) return false;
    const requiredMask = mouseButtonMask(this.activeMouseButton);
    if (requiredMask !== 0 && (event.buttons & requiredMask) === 0) {
      this.stopDragging();
      return false;
    }

    const previousMouse = this.lastMouse;
    this.lastMouse = [event.clientX, event.clientY];
    const dragAction = resolveMouseDragAction(this.activeMouseButton, event, this.dimensionMode) ?? this.activeDragAction;
    this.activeDragAction = dragAction;

    if (dragAction === 'fly') {
      const dx = event.clientX - previousMouse[0];
      const dy = event.clientY - previousMouse[1];
      this.flyLook(dx, dy);
    } else if (dragAction === 'orbit' && this.dimensionMode !== '2d') {
      const dx = (event.clientX - previousMouse[0]) * 0.005;
      const dy = (event.clientY - previousMouse[1]) * 0.005;
      this.orbit(dx, dy);
    } else if (dragAction === 'pan' || (dragAction === 'orbit' && this.dimensionMode === '2d')) {
      if (this.dimensionMode === '2d') {
        this.pan2D(event.clientX, event.clientY);
      } else {
        this.pan(canvas, previousMouse, this.lastMouse);
      }
    }

    return this.isDragging;
  }

  endPointerDrag(): void {
    if (this._flyMode) {
      this.exitFlyMode();
    }
    this.stopDragging();
  }

  lock(): void {
    this.cameraLocked = true;
    this.stopDragging();
  }

  unlock(): void {
    this.cameraLocked = false;
  }

  getCameraDistance(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    return Math.sqrt((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2);
  }

  /**
   * Effective camera distance for grid/scale calculations.
   * Always uses camera height above the ground plane (Z=0) so there is no
   * visual jump when entering or exiting fly mode (camera position is
   * unchanged at that moment, so the metric is continuous).
   */
  private getEffectiveCameraDistance(): number {
    return Math.max(1, Math.abs(this.camera.position[2]));
  }

  /** Get the effective distance for grid fade calculation.
   *  In 2D mode, returns visible half-extent so grid fades at screen edges.
   *  In 3D mode, returns effective camera distance (height-based in fly mode). */
  getGridFadeDistance(): number {
    if (this.dimensionMode === '2d') {
      const halfH = (Math.max(1, this.height) / 2) / this.numPixelsPerMeter;
      const aspect = Math.max(1, this.width) / Math.max(1, this.height);
      return Math.max(halfH, halfH * aspect);
    }
    return this.getEffectiveCameraDistance();
  }

  applyPan(canvas: HTMLCanvasElement, prevClientXY: [number, number], currClientXY: [number, number]): void {
    if (this.cameraLocked) return;
    if (this.dimensionMode === '2d') {
      // For touch pan in 2D: compute incremental offset directly
      const dx = (prevClientXY[0] - currClientXY[0]) / this.numPixelsPerMeter;
      const dy = (prevClientXY[1] - currClientXY[1]) / this.numPixelsPerMeter;
      const [px, py, pz] = this.camera.position;
      const [tx, ty, tz] = this.camera.target;
      this.camera.position = [px + dx, py - dy, pz];
      this.camera.target = [tx + dx, ty - dy, tz];
      this.viewDirty = true;
      this.onViewBecameDirty?.();
      this.reportScale();
    } else {
      this.pan(canvas, prevClientXY, currClientXY);
    }
  }

  applyZoomFactor(factor: number): void {
    if (this.cameraLocked) return;
    if (this.dimensionMode === '2d') {
      // For touch pinch in 2D: factor > 1 zooms out, < 1 zooms in
      this.numPixelsPerMeter /= factor;
      this.numPixelsPerMeter = Math.max(MINIMAL_SCALE, Math.min(MAXIMAL_SCALE, this.numPixelsPerMeter));
      this.viewDirty = true;
      this.onViewBecameDirty?.();
      this.reportScale();
    } else {
      this.zoom(factor);
    }
  }

  handleWheel(deltaY: number): void {
    if (this.cameraLocked) return;
    if (this._flyMode) {
      this.adjustFlySpeed(deltaY);
      return;
    }
    if (this.dimensionMode === '2d') {
      this.zoom2D(deltaY);
    } else {
      this.zoom(deltaY > 0 ? 1.1 : 0.9);
    }
  }

  // ── Fly mode (Unreal-style free-roaming camera) ───────────────────────────

  /** Whether the camera is currently in fly/pilot mode. */
  get isFlyMode(): boolean {
    return this._flyMode;
  }

  /** Current fly speed in meters per second. */
  get flySpeed(): number {
    return this._flySpeed;
  }

  /**
   * Enter fly mode. Computes initial yaw/pitch from the current
   * camera position → target direction. Only works in 3D mode.
   */
  enterFlyMode(): void {
    if (this.cameraLocked || this.dimensionMode === '2d') return;
    if (this._flyMode) return;

    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;

    this._flyYaw = Math.atan2(dy, dx);
    const horizDist = Math.sqrt(dx * dx + dy * dy);
    this._flyPitch = Math.atan2(dz, horizDist);

    // Auto-scale fly speed based on current camera distance
    const camDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this._flySpeed = Math.max(MIN_FLY_SPEED, Math.min(MAX_FLY_SPEED, camDist * 0.15));

    this._flyMode = true;
  }

  /**
   * Exit fly mode. Rebuilds the target point at a reasonable distance
   * in front of the camera along the current look direction,
   * preserving visual continuity when returning to orbit mode.
   */
  exitFlyMode(): void {
    if (!this._flyMode) return;
    this._flyMode = false;

    // Rebuild target at a distance proportional to camera height (natural orbit radius)
    const [px, py, pz] = this.camera.position;
    const cosPitch = Math.cos(this._flyPitch);
    const lookX = Math.cos(this._flyYaw) * cosPitch;
    const lookY = Math.sin(this._flyYaw) * cosPitch;
    const lookZ = Math.sin(this._flyPitch);
    const targetDist = Math.max(10, Math.abs(pz) * 0.5);
    this.camera.target = [
      px + lookX * targetDist,
      py + lookY * targetDist,
      pz + lookZ * targetDist,
    ];
    this.camera.up = [0, 0, 1];
    this.camera.near = Math.max(0.1, targetDist * 0.001);
    this.camera.far = Math.max(100000, targetDist * 100);

    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  /**
   * Rotate the camera view direction by mouse delta (mouselook).
   * dx/dy are raw pixel deltas from mouse movement.
   */
  flyLook(dx: number, dy: number): void {
    if (!this._flyMode) return;

    this._flyYaw += dx * FLY_LOOK_SENSITIVITY;
    this._flyPitch -= dy * FLY_LOOK_SENSITIVITY;
    this._flyPitch = Math.max(-FLY_MAX_PITCH, Math.min(FLY_MAX_PITCH, this._flyPitch));

    // Update target from yaw/pitch
    const [px, py, pz] = this.camera.position;
    const cosPitch = Math.cos(this._flyPitch);
    const lookX = Math.cos(this._flyYaw) * cosPitch;
    const lookY = Math.sin(this._flyYaw) * cosPitch;
    const lookZ = Math.sin(this._flyPitch);
    this.camera.target = [px + lookX, py + lookY, pz + lookZ];
    this.camera.up = [0, 0, 1];

    this.viewDirty = true;
    this.onViewBecameDirty?.();
  }

  /**
   * Move the camera in fly mode. Parameters are unit-scale direction
   * inputs (-1 to 1). deltaTime is in seconds.
   *
   * @param forward - Forward/backward (W/S: +1/-1)
   * @param right   - Strafe left/right (A/D: -1/+1)
   * @param up      - Up/down (E/Q: +1/-1)
   * @param deltaTime - Frame time in seconds
   * @param sprint  - Whether sprint (Shift) is held
   */
  flyMove(forward: number, right: number, up: number, deltaTime: number, sprint = false): void {
    if (!this._flyMode) return;

    const speed = this._flySpeed * (sprint ? FLY_SPRINT_MULTIPLIER : 1.0);
    const distance = speed * deltaTime;

    // Forward direction (projected on horizontal plane for WASD, full 3D for vertical)
    const cosPitch = Math.cos(this._flyPitch);
    const fwdX = Math.cos(this._flyYaw) * cosPitch;
    const fwdY = Math.sin(this._flyYaw) * cosPitch;
    const fwdZ = Math.sin(this._flyPitch);

    // Right direction (perpendicular to forward on XY plane)
    const rightX = Math.cos(this._flyYaw - Math.PI / 2);
    const rightY = Math.sin(this._flyYaw - Math.PI / 2);

    // Compute total displacement
    const moveX = (fwdX * forward + rightX * right) * distance;
    const moveY = (fwdY * forward + rightY * right) * distance;
    const moveZ = (fwdZ * forward + up) * distance;

    const [px, py, pz] = this.camera.position;
    this.camera.position = [px + moveX, py + moveY, pz + moveZ];
    // Keep target at unit distance in look direction
    const lookX = Math.cos(this._flyYaw) * cosPitch;
    const lookY = Math.sin(this._flyYaw) * cosPitch;
    const lookZ = Math.sin(this._flyPitch);
    this.camera.target = [
      px + moveX + lookX,
      py + moveY + lookY,
      pz + moveZ + lookZ,
    ];

    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  /** Adjust fly speed via scroll wheel delta. */
  adjustFlySpeed(deltaY: number): void {
    const notches = deltaY / 120;
    this._flySpeed *= Math.pow(1.15, -notches);
    this._flySpeed = Math.max(MIN_FLY_SPEED, Math.min(MAX_FLY_SPEED, this._flySpeed));
  }

  computeViewProj(): Float32Array {
    if (!this.viewDirty && this.cachedViewProjForRender) {
      return this.cachedViewProjForRender;
    }
    const aspect = this.width / this.height;
    const view = lookAtMatrix(this.camera.position, this.camera.target, this.camera.up);

    let proj: Float32Array;
    if (this.dimensionMode === '2d') {
      // Orthographic projection: visible area determined by numPixelsPerMeter
      const halfH = (this.height / 2) / this.numPixelsPerMeter;
      const halfW = halfH * aspect;
      proj = orthographicMatrix(-halfW, halfW, -halfH, halfH, this.camera.near, this.camera.far);
    } else {
      proj = perspectiveMatrix(this.camera.fovY, aspect, this.camera.near, this.camera.far);
    }

    const result = multiplyMatrices(DEPTH_CORRECTION, multiplyMatrices(proj, view));
    this.cachedViewProjForRender = result;
    this.viewDirty = false;
    return result;
  }

  private stopDragging(): void {
    this.isDragging = false;
    this.activeMouseButton = null;
    this.activeDragAction = null;
  }

  private orbit(dx: number, dy: number): void {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const ox = px - tx;
    const oy = py - ty;
    const oz = pz - tz;
    const r = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const theta = Math.atan2(oy, ox) + dx;
    let phi = Math.acos(Math.min(1, Math.max(-1, oz / r))) - dy;
    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));

    this.camera.position = [
      tx + r * Math.sin(phi) * Math.cos(theta),
      ty + r * Math.sin(phi) * Math.sin(theta),
      tz + r * Math.cos(phi),
    ];
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  private zoom(factor: number): void {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dist = Math.min(MAX_CAM_DIST, Math.max(MIN_CAM_DIST, currentDist * factor));
    const norm = currentDist;
    this.camera.position = [
      tx - (dx / norm) * dist,
      ty - (dy / norm) * dist,
      tz - (dz / norm) * dist,
    ];
    this.camera.near = Math.max(0.1, dist * 0.001);
    this.camera.far = Math.max(100000, dist * 100);
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  /** 2D zoom: adjust numPixelsPerMeter (matching C# Camera2D.OnMouseWheel). */
  private zoom2D(deltaY: number): void {
    const zoomSpeed = 0.1;
    // deltaY > 0 means scroll down (zoom out), deltaY < 0 means scroll up (zoom in)
    // Normalize: typical deltaY is ±100-120 per notch
    const notches = deltaY / 120;
    this.numPixelsPerMeter *= Math.pow(1.0 + zoomSpeed, -notches);
    this.numPixelsPerMeter = Math.max(MINIMAL_SCALE, Math.min(MAXIMAL_SCALE, this.numPixelsPerMeter));
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  /**
   * 2D pan: compute total offset from drag start (C# Camera2D.OnMouseMove style).
   * This keeps the world point under the initial click exactly under the cursor.
   */
  private pan2D(clientX: number, clientY: number): void {
    const dx = (this.panStartMouse[0] - clientX) / this.numPixelsPerMeter;
    const dy = (this.panStartMouse[1] - clientY) / this.numPixelsPerMeter;

    this.camera.target = [
      this.panStartTarget[0] + dx,
      this.panStartTarget[1] - dy,
      this.panStartTarget[2],
    ];
    this.camera.position = [
      this.panStartPosition[0] + dx,
      this.panStartPosition[1] - dy,
      this.panStartPosition[2],
    ];
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  private pan(
    canvas: HTMLCanvasElement,
    previousMouse: [number, number],
    currentMouse: [number, number],
  ): void {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const previousWorld = this.unprojectClientToGround(canvas, previousMouse);
    const currentWorld = this.unprojectClientToGround(canvas, currentMouse);
    const offset = computeGroundPanOffset(previousWorld, currentWorld);
    if (!offset) return;

    this.camera.position = [px + offset.x, py + offset.y, pz];
    this.camera.target = [tx + offset.x, ty + offset.y, tz];
    this.viewDirty = true;
    this.onViewBecameDirty?.();
    this.reportScale();
  }

  private unprojectClientToGround(
    canvas: HTMLCanvasElement,
    clientPoint: [number, number],
  ): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const screenX = (clientPoint[0] - rect.left) * (canvas.width / rect.width);
    const screenY = (clientPoint[1] - rect.top) * (canvas.height / rect.height);
    return this.unprojectToGround(screenX, screenY);
  }
}
