import { mouseButtonMask, resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';
import type { MouseDragAction } from './viewportTypes';
import {
  perspectiveMatrix,
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

const MIN_CAM_DIST = 2.0;
const MAX_CAM_DIST = 2000.0;

/** Camera state, transforms, and orbit/pan/zoom input handling for the viewport. */
export class CameraController {
  private camera: CameraState = {
    position: [0, -100, 50],
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
  private gridSpacing = 10.0;
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

  get state(): Readonly<CameraState> {
    return this.camera;
  }

  resetCamera(): void {
    this.camera = {
      position: [0, -100, 50],
      target: [0, 0, 0],
      up: [0, 0, 1],
      fovY: Math.PI / 4,
      near: 0.1,
      far: 100000,
    };
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
    return this.gridSpacing;
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

  /** Compute current meters-per-pixel (perspective approximation at target distance). */
  getMetersPerPixel(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const camDist = Math.sqrt((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2);
    const halfWorldWidth = camDist * Math.tan(this.camera.fovY / 2);
    return (halfWorldWidth * 2) / Math.max(1, this.width);
  }

  reportScale(): void {
    const info = { gridSpacing: this.gridSpacing, mpp: this.getMetersPerPixel() };
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
    const dist = this.getCameraDistance();

    if (dimension === '2d') {
      this._animEndPos = [tx, ty, tz + dist];
      this._animEndUp = [0, 1, 0];
    } else {
      this._animEndPos = [tx, ty - dist * 0.5, tz + dist * 0.7];
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

    this.gridSpacing = niceNumber(Math.max(maxExtent / 10, 0.5));

    const dist = maxExtent * 0.8;
    this.camera.target = [cx, cy, cz];
    if (this.dimensionMode === '2d') {
      this.camera.position = [cx, cy, cz + dist];
      this.camera.up = [0, 1, 0];
    } else {
      this.camera.position = [cx, cy - dist * 0.5, cz + dist];
      this.camera.up = [0, 0, 1];
    }
    this.camera.near = Math.max(0.1, maxExtent * 0.001);
    this.camera.far = Math.max(100000, maxExtent * 10);
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

  beginPointerDrag(button: number, event: Pick<MouseEvent, 'clientX' | 'clientY' | 'ctrlKey' | 'shiftKey'>): boolean {
    if (this.cameraLocked) return false;
    const action = resolveMouseDragAction(button, event);
    if (!action) return false;
    this.isDragging = true;
    this.activeMouseButton = button;
    this.activeDragAction = action;
    this.lastMouse = [event.clientX, event.clientY];
    return true;
  }

  updatePointerDrag(
    canvas: HTMLCanvasElement,
    event: Pick<MouseEvent, 'buttons' | 'clientX' | 'clientY' | 'ctrlKey' | 'shiftKey'>,
  ): boolean {
    if (!this.isDragging || this.activeMouseButton === null) return false;
    const requiredMask = mouseButtonMask(this.activeMouseButton);
    if (requiredMask !== 0 && (event.buttons & requiredMask) === 0) {
      this.stopDragging();
      return false;
    }

    const previousMouse = this.lastMouse;
    this.lastMouse = [event.clientX, event.clientY];
    const dragAction = resolveMouseDragAction(this.activeMouseButton, event) ?? this.activeDragAction;
    this.activeDragAction = dragAction;

    if (dragAction === 'orbit' && this.dimensionMode !== '2d') {
      const dx = (event.clientX - previousMouse[0]) * 0.005;
      const dy = (event.clientY - previousMouse[1]) * 0.005;
      this.orbit(dx, dy);
    } else if (dragAction === 'pan' || (dragAction === 'orbit' && this.dimensionMode === '2d')) {
      this.pan(canvas, previousMouse, this.lastMouse);
    }

    return this.isDragging;
  }

  endPointerDrag(): void {
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

  applyPan(canvas: HTMLCanvasElement, prevClientXY: [number, number], currClientXY: [number, number]): void {
    if (this.cameraLocked) return;
    this.pan(canvas, prevClientXY, currClientXY);
  }

  applyZoomFactor(factor: number): void {
    if (this.cameraLocked) return;
    this.zoom(factor);
  }

  handleWheel(deltaY: number): void {
    if (this.cameraLocked) return;
    this.zoom(deltaY > 0 ? 1.1 : 0.9);
  }

  computeViewProj(): Float32Array {
    if (!this.viewDirty && this.cachedViewProjForRender) {
      return this.cachedViewProjForRender;
    }
    const aspect = this.width / this.height;
    const proj = perspectiveMatrix(this.camera.fovY, aspect, this.camera.near, this.camera.far);
    const view = lookAtMatrix(this.camera.position, this.camera.target, this.camera.up);
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
