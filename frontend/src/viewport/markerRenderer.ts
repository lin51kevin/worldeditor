import {
  computeControlPointPositions,
  pickControlPoint as pickControlPointFn,
} from './tangentHandleController';
import type { ControlPointRef } from './tangentHandleController';
import { buildSplineCurveVertices, buildSplineMarkerVertices } from './splineVertexBuilder';

export interface RenderableMesh {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
}

export type ControlPointState = { index: number; type: 'knot' | 'in' | 'out' };

/** Manages spline preview meshes and control-point marker state. */
export class MarkerRenderer {
  private device: GPUDevice | null = null;
  private splineCurveMeshes: RenderableMesh[] = [];
  private splineMarkerMeshes: RenderableMesh[] = [];
  private splineKnotsCache: Array<[number, number, number]> = [];
  private splineTangentCache: Record<number, [number, number, number]> | undefined = undefined;
  private splineTangentInCache: Record<number, [number, number, number]> | undefined = undefined;
  private hoveredControlPoint: ControlPointState | null = null;
  private selectedControlPoint: ControlPointState | null = null;
  /** When true, handle endpoint X-squares are hidden (draw mode). */
  private drawMode = false;

  setDevice(device: GPUDevice): void {
    this.device = device;
  }

  get curveMeshes(): readonly RenderableMesh[] {
    return this.splineCurveMeshes;
  }

  get markerMeshes(): readonly RenderableMesh[] {
    return this.splineMarkerMeshes;
  }

  get knots(): ReadonlyArray<readonly [number, number, number]> {
    return this.splineKnotsCache;
  }

  get tangentOverrides(): Readonly<Record<number, readonly [number, number, number]>> {
    return this.splineTangentCache ?? {};
  }

  get hovered(): ControlPointState | null {
    return this.hoveredControlPoint;
  }

  get selected(): ControlPointState | null {
    return this.selectedControlPoint;
  }

  get knotCount(): number {
    return this.splineKnotsCache.length;
  }

  setTangentOverrides(overrides: Record<number, [number, number, number]> | undefined): void {
    this.splineTangentCache = overrides;
  }

  setTangentInOverrides(overrides: Record<number, [number, number, number]> | undefined): void {
    this.splineTangentInCache = overrides;
  }

  setSplinePreviewKnots(
    knots: Array<[number, number, number]>,
    tangentOverrides: Record<number, [number, number, number]> | undefined,
    mpp: number,
    clearColor: { r: number; g: number; b: number; a: number },
    isDrawMode = false,
    skipCurve = false,
  ): void {
    this.drawMode = isDrawMode;
    // When skipCurve=true, preserve existing curve meshes (center line uploaded
    // separately via setCurveFromVertexData). Only dispose when we'll rebuild.
    if (!skipCurve) {
      this.disposeMeshes(this.splineCurveMeshes);
    }
    this.disposeMeshes(this.splineMarkerMeshes);
    this.splineKnotsCache = knots;
    this.splineTangentCache = tangentOverrides;
    this.hoveredControlPoint = null;
    this.selectedControlPoint = null;

    if (knots.length === 0) {
      // Clear everything when no knots
      if (skipCurve) {
        this.disposeMeshes(this.splineCurveMeshes);
      }
      return;
    }

    // In draw mode, skip the yellow Hermite curve — the road shape is already
    // visualised as lane-boundary + center-line by useSplineDrawPreview.
    // In geometry-edit mode (skipCurve=true), always rebuild the synchronous
    // Hermite curve from the current tangent overrides so tangent handle drags
    // give immediate visual feedback. setCurveFromVertexData() will replace it
    // with the exact WASM center-line once the async preview completes.
    if (!isDrawMode) {
      this.refreshSplineCurve(mpp);
    }
    this.refreshSplineMarkers(mpp, clearColor);
  }

  refreshSplineCurve(mpp: number): void {
    this.disposeMeshes(this.splineCurveMeshes);
    if (!this.device || this.splineKnotsCache.length < 2) return;

    const curveVerts = buildSplineCurveVertices(this.splineKnotsCache, this.splineTangentCache, mpp);
    this.uploadToMeshArray(this.splineCurveMeshes, curveVerts);
  }

  refreshSplineMarkers(
    mpp: number,
    clearColor: { r: number; g: number; b: number; a: number },
    hovered?: ControlPointState | null,
    selected?: ControlPointState | null,
  ): void {
    if (hovered !== undefined) this.hoveredControlPoint = hovered;
    if (selected !== undefined) this.selectedControlPoint = selected;

    this.disposeMeshes(this.splineMarkerMeshes);
    if (!this.device || this.splineKnotsCache.length === 0) return;

    const markerVerts = buildSplineMarkerVertices(
      this.splineKnotsCache,
      this.splineTangentCache,
      mpp,
      clearColor,
      this.hoveredControlPoint,
      this.selectedControlPoint,
      this.splineTangentInCache,
      !this.drawMode,
    );
    this.uploadToMeshArray(this.splineMarkerMeshes, markerVerts);
  }

  pickControlPoint(wx: number, wy: number, mpp: number): ControlPointRef | null {
    if (this.splineKnotsCache.length === 0) return null;
    const thresholdMeters = 10.0 * mpp;
    const positions = computeControlPointPositions(this.splineKnotsCache, this.splineTangentCache ?? {}, this.splineTangentInCache, mpp);
    return pickControlPointFn(wx, wy, positions, thresholdMeters);
  }

  /**
   * Upload pre-computed curve vertex data (e.g. road center line) as the spline
   * curve mesh. Replaces any existing Hermite curve. Vertex format: 7 floats per
   * vertex (x, y, z, r, g, b, a), triangle-list.
   */
  setCurveFromVertexData(data: Float32Array): void {
    this.disposeMeshes(this.splineCurveMeshes);
    if (!this.device || data.length === 0) return;
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    this.splineCurveMeshes.push({ vertexBuffer: buffer, vertexCount: data.length / 7 });
  }

  dispose(): void {
    this.disposeMeshes(this.splineCurveMeshes);
    this.disposeMeshes(this.splineMarkerMeshes);
  }

  private uploadToMeshArray(meshArray: RenderableMesh[], vertices: number[]): void {
    if (!this.device || vertices.length === 0) return;
    const vertexData = new Float32Array(vertices);
    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();
    meshArray.push({ vertexBuffer: buffer, vertexCount: vertices.length / 7 });
  }

  private disposeMeshes(meshes: RenderableMesh[]): void {
    for (const mesh of meshes) {
      mesh.vertexBuffer.destroy();
    }
    meshes.length = 0;
  }
}
