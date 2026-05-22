/**
 * useViewportMeshes — manages surface mesh, line mesh, and the shared
 * visible-project cache used by both mesh pipelines and pick/snap.
 *
 * Extracted from Viewport.tsx for single-responsibility:
 *   • Builds and caches the "renderable project" (filtered by display settings)
 *   • Pushes the project into the WASM-side cache for 60 Hz pick/snap
 *   • Generates and uploads road/junction/signal/object surface vertices
 *   • Generates and uploads lane-line/center-line vertices
 *   • Resets caches on new file load
 */
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildRenderableProject } from '../utils/sceneGraph';
import { mergeFloat32Arrays } from '../components/viewportUtils';
import type { Project } from '../services/platform';

interface UseViewportMeshesParams {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
}

interface UseViewportMeshesReturn {
  /** Get (or rebuild) the visible-project filtered by display settings. */
  getVisibleProject: () => Project | null;
  /** Regenerate surface mesh (roads + junctions + signals + objects). */
  updateSurfaceMesh: () => Promise<void>;
  /** Regenerate line mesh (lane lines + center/reference lines). */
  updateLineMesh: () => Promise<void>;
  /** Regenerate bridge/tunnel overlay mesh. */
  updateOverlayMesh: () => Promise<void>;
}

export function useViewportMeshes({
  rendererRef,
  status,
}: UseViewportMeshesParams): UseViewportMeshesReturn {
  const project = useProjectStore((s) => s.project);
  const projectLoadVersion = useProjectStore((s) => s.projectLoadVersion);
  const { display, viewMode } = useViewportStore();

  // ── Shared renderable project cache ────────────────────────────────────
  const visibleProjectRef = useRef<ReturnType<typeof buildRenderableProject> | null>(null);
  const visibleProjectKeyRef = useRef<string>('');
  const projectRef = useRef(project);

  const getVisibleProject = useCallback((): Project | null => {
    const key = JSON.stringify({ d: display, v: projectLoadVersion });
    if (key !== visibleProjectKeyRef.current || project !== projectRef.current || !visibleProjectRef.current) {
      visibleProjectKeyRef.current = key;
      projectRef.current = project;
      visibleProjectRef.current = project ? buildRenderableProject(project, display) : null;
    }
    return visibleProjectRef.current;
  }, [project, display, projectLoadVersion]);

  // ── WASM project cache lifecycle ───────────────────────────────────────
  // Pushes the visible project into the WASM-side cache once per change,
  // so that 60 Hz pick/snap calls avoid per-call JSON serialisation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vp = getVisibleProject();
      if (!vp || cancelled) return;
      try {
        const service = await getPlatformService();
        await service.setProjectCache(vp);
      } catch {
        // Non-fatal: cached pick will fall back to uncached path.
      }
    })();
    return () => { cancelled = true; };
  }, [getVisibleProject]);

  // ── Surface mesh (roads + junctions + signals + objects) ───────────────
  const surfaceDepsRef = useRef<{
    roadRefs: Map<string, unknown>;
    junctionRefs: Map<string, unknown>;
  }>({ roadRefs: new Map(), junctionRefs: new Map() });
  const cachedSurfaceRef = useRef<Float32Array>(new Float32Array(0));
  const surfaceViewModeRef = useRef(viewMode);

  const updateSurfaceMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;
    const tStart = performance.now();

    try {
      const service = await getPlatformService();
      const tService = performance.now();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;

      // Detect whether any road/junction actually changed via reference equality.
      const prev = surfaceDepsRef.current;
      const newRoadRefs = new Map(visibleProject.roads.map((r) => [r.id, r]));
      const newJunctionRefs = new Map(visibleProject.junctions.map((j) => [j.id, j]));

      const roadsChanged =
        newRoadRefs.size !== prev.roadRefs.size ||
        [...newRoadRefs].some(([id, ref]) => prev.roadRefs.get(id) !== ref);
      const junctionsChanged =
        newJunctionRefs.size !== prev.junctionRefs.size ||
        [...newJunctionRefs].some(([id, ref]) => prev.junctionRefs.get(id) !== ref);
      const modeChanged = surfaceViewModeRef.current !== viewMode;

      surfaceDepsRef.current = { roadRefs: newRoadRefs, junctionRefs: newJunctionRefs };
      surfaceViewModeRef.current = viewMode;

      if (!roadsChanged && !junctionsChanged && !modeChanged && cachedSurfaceRef.current.length > 0) {
        console.info(`[Viewport:perf] updateSurfaceMesh skipped (no change) ${(performance.now() - tStart).toFixed(1)}ms`);
        return;
      }

      const empty = Promise.resolve(new Float32Array(0));
      // Connector roads render their road surfaces but NOT lane lines.
      // Road surface rendering uses full visibleProject (includes connectors).
      const roadProm = viewMode === 'solid'
        ? service.generateRoadVertices(visibleProject, 2.0, display.colorMode).catch((e) => { console.warn('[Viewport] generateRoadVertices failed:', e); return new Float32Array(0); })
        : empty;
      const junctionProm = viewMode === 'solid'
        ? service.generateJunctionVertices(visibleProject).catch((e) => { console.warn('[Viewport] generateJunctionVertices failed:', e); return new Float32Array(0); })
        : empty;
      const signalProm = viewMode === 'solid' && display.showSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const objectProm = viewMode === 'solid' && display.showObjects
        ? service.generateObjectVertices(visibleProject).catch(() => new Float32Array(0))
        : empty;

      const [roadVerts, junctionVerts, signalVerts, objectVerts] = await Promise.all([
        roadProm, junctionProm, signalProm, objectProm,
      ]);
      const tWasm = performance.now();

      const surfaceVerts = mergeFloat32Arrays(
        mergeFloat32Arrays(mergeFloat32Arrays(roadVerts, junctionVerts), signalVerts),
        objectVerts,
      );
      cachedSurfaceRef.current = surfaceVerts;
      if (viewMode === 'solid') {
        renderer.uploadRoadVertices(surfaceVerts);
      } else {
        renderer.uploadRoadVertices(surfaceVerts, { preserveLastVertexDataOnEmpty: true });
      }
      const tDone = performance.now();
      console.info(
        `[Viewport:perf] updateSurfaceMesh total=${(tDone - tStart).toFixed(1)}ms | ` +
        `service=${(tService - tStart).toFixed(1)} wasm=${(tWasm - tService).toFixed(1)} ` +
        `upload=${(tDone - tWasm).toFixed(1)} roads=${visibleProject.roads.length} verts=${surfaceVerts.length / 7}`,
      );
    } catch (err) {
      console.error('[Viewport] Failed to generate surface mesh:', err);
    }
  }, [
    project,
    status,
    viewMode,
    display.showSignals,
    display.showObjects,
    display.colorMode,
    display.hiddenRoadIds,
    display.hiddenJunctionIds,
    display.hiddenLaneSectionKeys,
    display.hiddenLaneKeys,
    display.hiddenSignalKeys,
    display.hiddenObjectKeys,
  ]);

  // ── Line mesh (lane lines + center/reference lines) ────────────────────
  const updateLineMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;

      const empty = Promise.resolve(new Float32Array(0));
      // Exclude connector roads from line rendering — their surfaces are shown
      // but lane lines/marks inside the junction area are hidden (C# reference behavior).
      const nonConnectorProject = {
        ...visibleProject,
        roads: visibleProject.roads.filter((r) => !r.junction_id),
      };
      const centerLineProm = (display.showReferenceLine || viewMode !== 'solid')
        ? service.generateCenterLineVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const laneBoundaryProm = viewMode !== 'solid'
        ? service.generateLaneBoundaryVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const roadMarkProm = (viewMode === 'wire' || (viewMode === 'solid' && display.showLaneLines))
        ? service.generateLaneLineVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0))
        : empty;

      const [laneBoundaryVerts, roadMarkVerts, centerLineVerts] = await Promise.all([
        laneBoundaryProm, roadMarkProm, centerLineProm,
      ]);
      const lineVerts = mergeFloat32Arrays(
        mergeFloat32Arrays(laneBoundaryVerts, roadMarkVerts),
        centerLineVerts,
      );
      renderer.uploadLaneLineVertices(lineVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate line mesh:', err);
    }
  }, [
    project,
    status,
    viewMode,
    display.showLaneLines,
    display.showRoadMarks,
    display.showReferenceLine,
    display.hiddenRoadIds,
    display.hiddenJunctionIds,
    display.hiddenLaneSectionKeys,
    display.hiddenLaneKeys,
  ]);

  // ── Reset caches on new file load ──────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (status !== 'ready') return;
    renderer?.clearVertexCache();
    visibleProjectRef.current = null;
    visibleProjectKeyRef.current = '';
    surfaceDepsRef.current = { roadRefs: new Map(), junctionRefs: new Map() };
    cachedSurfaceRef.current = new Float32Array(0);
  }, [projectLoadVersion, status]);

  // ── Overlay mesh (bridge/tunnel structures) ────────────────────────────
  const updateOverlayMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;
      const hasBridgeTunnel = visibleProject.roads.some(
        (r) => (r.bridges?.length ?? 0) > 0 || (r.tunnels?.length ?? 0) > 0,
      );
      if (!hasBridgeTunnel) {
        renderer.uploadOverlayVertices(new Float32Array(0));
        return;
      }
      const verts = await service
        .generateBridgeTunnelVertices(visibleProject)
        .catch(() => new Float32Array(0));
      renderer.uploadOverlayVertices(verts);
    } catch (err) {
      console.error('[Viewport] Failed to generate overlay mesh:', err);
    }
  }, [project, status, display.hiddenRoadIds]);

  // ── Trigger mesh updates when deps change ──────────────────────────────
  useEffect(() => { updateSurfaceMesh(); }, [updateSurfaceMesh]);
  useEffect(() => { updateLineMesh(); }, [updateLineMesh]);
  useEffect(() => { void updateOverlayMesh(); }, [updateOverlayMesh]);

  return { getVisibleProject, updateSurfaceMesh, updateLineMesh, updateOverlayMesh };
}
