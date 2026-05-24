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

  // ── Split display into data-affecting vs render-only ───────────────────
  // Data-affecting properties change WHICH roads/lanes/signals are in the visible project.
  // Render-only properties control which mesh layers are SHOWN (no data rebuild needed).
  const dataDisplayKey = JSON.stringify({
    hiddenRoadIds: display.hiddenRoadIds,
    hiddenJunctionIds: display.hiddenJunctionIds,
    hiddenLaneSectionKeys: display.hiddenLaneSectionKeys,
    hiddenLaneKeys: display.hiddenLaneKeys,
    hiddenSignalKeys: display.hiddenSignalKeys,
    hiddenObjectKeys: display.hiddenObjectKeys,
  });

  // ── Shared renderable project cache ────────────────────────────────────
  const visibleProjectRef = useRef<ReturnType<typeof buildRenderableProject> | null>(null);
  const visibleProjectKeyRef = useRef<string>('');
  const projectRef = useRef(project);

  // getVisibleProject only rebuilds when DATA changes (hidden items), not render toggles
  const getVisibleProject = useCallback((): Project | null => {
    const key = dataDisplayKey + ':' + projectLoadVersion;
    if (key !== visibleProjectKeyRef.current || project !== projectRef.current || !visibleProjectRef.current) {
      visibleProjectKeyRef.current = key;
      projectRef.current = project;
      visibleProjectRef.current = project ? buildRenderableProject(project, display) : null;
    }
    return visibleProjectRef.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, dataDisplayKey, projectLoadVersion]);

  // ── WASM project cache lifecycle ───────────────────────────────────────
  // Only re-pushes when the visible project DATA changes (not on render toggles).
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
  // Layered caching: each layer is cached independently so that toggling
  // show/hide flags only requires a re-merge + GPU upload, not WASM regeneration.
  const surfaceDepsRef = useRef<{
    roadRefs: Map<string, unknown>;
    junctionRefs: Map<string, unknown>;
  }>({ roadRefs: new Map(), junctionRefs: new Map() });
  const cachedRoadVertsRef = useRef<Float32Array>(new Float32Array(0));
  const cachedJunctionVertsRef = useRef<Float32Array>(new Float32Array(0));
  const cachedSignalVertsRef = useRef<Float32Array>(new Float32Array(0));
  const cachedObjectVertsRef = useRef<Float32Array>(new Float32Array(0));
  const surfaceColorModeRef = useRef(display.colorMode);

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
      const colorModeChanged = surfaceColorModeRef.current !== display.colorMode;

      // Granular invalidation:
      // - viewMode change does NOT require WASM regeneration (surfaces cached from solid mode)
      // - colorMode only affects road vertices
      const needRoads = roadsChanged || colorModeChanged || cachedRoadVertsRef.current.length === 0;
      const needJunctions = junctionsChanged || roadsChanged || cachedJunctionVertsRef.current.length === 0;
      const needSignals = roadsChanged || junctionsChanged || cachedSignalVertsRef.current.length === 0;
      const needObjects = roadsChanged || junctionsChanged || cachedObjectVertsRef.current.length === 0;

      surfaceDepsRef.current = { roadRefs: newRoadRefs, junctionRefs: newJunctionRefs };
      surfaceColorModeRef.current = display.colorMode;

      // Only regenerate layers that actually need updating (always generate for solid cache)
      const empty = Promise.resolve(new Float32Array(0));

      // For road vertices: use cached WASM fn (no JSON serialization) when only colorMode changed
      // Falls back to full-serialization path if cached function unavailable
      const roadProm = needRoads
        ? ((!roadsChanged && service.generateRoadVerticesCached)
            ? service.generateRoadVerticesCached(2.0, display.colorMode).catch(() =>
                service.generateRoadVertices(visibleProject, 2.0, display.colorMode))
            : service.generateRoadVertices(visibleProject, 2.0, display.colorMode)
          ).catch((e) => { console.warn('[Viewport] generateRoadVertices failed:', e); return new Float32Array(0); })
        : empty;
      const junctionProm = needJunctions
        ? service.generateJunctionVertices(visibleProject).catch((e) => { console.warn('[Viewport] generateJunctionVertices failed:', e); return new Float32Array(0); })
        : empty;
      const signalProm = needSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const objectProm = needObjects
        ? service.generateObjectVertices(visibleProject).catch(() => new Float32Array(0))
        : empty;

      const [roadVerts, junctionVerts, signalVerts, objectVerts] = await Promise.all([
        roadProm, junctionProm, signalProm, objectProm,
      ]);

      if (needRoads) cachedRoadVertsRef.current = roadVerts;
      if (needJunctions) cachedJunctionVertsRef.current = junctionVerts;
      if (needSignals) cachedSignalVertsRef.current = signalVerts;
      if (needObjects) cachedObjectVertsRef.current = objectVerts;

      // Merge visible layers — in non-solid mode, surfaces are hidden (not cleared)
      const tWasm = performance.now();
      let uploadedVertCount = 0;
      if (viewMode !== 'solid') {
        // Wire/sketch: no surface polygons, just preserve last frame for smooth transition
        renderer.uploadRoadVertices(new Float32Array(0), { preserveLastVertexDataOnEmpty: true });
      } else {
        let surfaceVerts = mergeFloat32Arrays(cachedRoadVertsRef.current, cachedJunctionVertsRef.current);
        if (display.showSignals && cachedSignalVertsRef.current.length > 0) {
          surfaceVerts = mergeFloat32Arrays(surfaceVerts, cachedSignalVertsRef.current);
        }
        if (display.showObjects && cachedObjectVertsRef.current.length > 0) {
          surfaceVerts = mergeFloat32Arrays(surfaceVerts, cachedObjectVertsRef.current);
        }
        uploadedVertCount = surfaceVerts.length / 7;
        renderer.uploadRoadVertices(surfaceVerts);
      }
      const tDone = performance.now();
      const anyRegenerated = needRoads || needJunctions || needSignals || needObjects;
      console.info(
        `[Viewport:perf] updateSurfaceMesh total=${(tDone - tStart).toFixed(1)}ms | ` +
        `service=${(tService - tStart).toFixed(1)} wasm=${(tWasm - tService).toFixed(1)} ` +
        `upload=${(tDone - tWasm).toFixed(1)} roads=${visibleProject.roads.length} verts=${uploadedVertCount}` +
        (anyRegenerated ? ` [regen: R=${needRoads ? 1 : 0} J=${needJunctions ? 1 : 0} S=${needSignals ? 1 : 0} O=${needObjects ? 1 : 0}]` : ' [cached-merge]'),
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
  // Layered caching: each line type is cached independently.
  const cachedCenterLineVertsRef = useRef<Float32Array>(new Float32Array(0));
  const cachedLaneBoundaryVertsRef = useRef<Float32Array>(new Float32Array(0));
  const cachedRoadMarkVertsRef = useRef<Float32Array>(new Float32Array(0));
  const lineDepsKeyRef = useRef<string>('');
  const lineProjectRef = useRef<Project | null>(null);

  const updateLineMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;

      // Check if underlying data changed — viewMode NOT included (all layers cached regardless)
      const lineKey = dataDisplayKey + ':' + projectLoadVersion;
      const dataChanged = lineKey !== lineDepsKeyRef.current || visibleProject !== lineProjectRef.current;

      if (dataChanged) {
        lineDepsKeyRef.current = lineKey;
        lineProjectRef.current = visibleProject;

        // Exclude connector roads from line rendering
        const nonConnectorProject = {
          ...visibleProject,
          roads: visibleProject.roads.filter((r) => !r.junction_id),
        };
        // Always generate all line layers so mode switching is instant
        const [centerLineVerts, laneBoundaryVerts, roadMarkVerts] = await Promise.all([
          service.generateCenterLineVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0)),
          service.generateLaneBoundaryVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0)),
          service.generateLaneLineVertices(nonConnectorProject, 2.0).catch(() => new Float32Array(0)),
        ]);

        cachedCenterLineVertsRef.current = centerLineVerts;
        cachedLaneBoundaryVertsRef.current = laneBoundaryVerts;
        cachedRoadMarkVertsRef.current = roadMarkVerts;
      }

      // Merge only visible layers based on current viewMode (no WASM calls)
      let lineVerts: Float32Array = new Float32Array(0);
      if (viewMode !== 'solid') {
        // Wire/sketch: show boundaries + center + road marks
        lineVerts = cachedLaneBoundaryVertsRef.current;
        lineVerts = mergeFloat32Arrays(lineVerts, cachedRoadMarkVertsRef.current);
        lineVerts = mergeFloat32Arrays(lineVerts, cachedCenterLineVertsRef.current);
      } else {
        // Solid: conditionally show lane lines and reference line
        if (display.showLaneLines) {
          lineVerts = mergeFloat32Arrays(lineVerts, cachedRoadMarkVertsRef.current);
        }
        if (display.showReferenceLine) {
          lineVerts = mergeFloat32Arrays(lineVerts, cachedCenterLineVertsRef.current);
        }
      }
      renderer.uploadLaneLineVertices(lineVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate line mesh:', err);
    }
  }, [
    project,
    status,
    viewMode,
    dataDisplayKey,
    projectLoadVersion,
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
    cachedRoadVertsRef.current = new Float32Array(0);
    cachedJunctionVertsRef.current = new Float32Array(0);
    cachedSignalVertsRef.current = new Float32Array(0);
    cachedObjectVertsRef.current = new Float32Array(0);
    cachedCenterLineVertsRef.current = new Float32Array(0);
    cachedLaneBoundaryVertsRef.current = new Float32Array(0);
    cachedRoadMarkVertsRef.current = new Float32Array(0);
    lineDepsKeyRef.current = '';
    lineProjectRef.current = null;
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
