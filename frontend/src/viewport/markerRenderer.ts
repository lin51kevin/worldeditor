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
  private hoveredControlPoint: ControlPointState | null = null;
  private selectedControlPoint: ControlPointState | null = null;

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

  setSplinePreviewKnots(
    knots: Array<[number, number, number]>,
    tangentOverrides: Record<number, [number, number, number]> | undefined,
    mpp: number,
    clearColor: { r: number; g: number; b: number; a: number },
  ): void {
    this.disposeMeshes(this.splineCurveMeshes);
    this.disposeMeshes(this.splineMarkerMeshes);
    this.splineKnotsCache = knots;
    this.splineTangentCache = tangentOverrides;
    this.hoveredControlPoint = null;
    this.selectedControlPoint = null;

    if (knots.length === 0) return;

    this.refreshSplineCurve(mpp);
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
    );
    this.uploadToMeshArray(this.splineMarkerMeshes, markerVerts);
  }

  pickControlPoint(wx: number, wy: number, mpp: number): ControlPointRef | null {
    if (this.splineKnotsCache.length === 0) return null;
    const thresholdMeters = 10.0 * mpp;
    const positions = computeControlPointPositions(this.splineKnotsCache, this.splineTangentCache ?? {});
    return pickControlPointFn(wx, wy, positions, thresholdMeters);
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
