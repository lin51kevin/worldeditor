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

/**
 * Coarsest reference-line sampling step (metres) for road/lane tessellation.
 *
 * The WASM samplers are adaptive (curvature-driven): this value is the upper
 * bound applied on straight sections, while tight curves refine down to ~0.5 m
 * within a 0.01 m chord-error tolerance. Mirrors WorldEditorOnline's
 * `TESSELLATION_MAX_STEP_IN_METERS`.
 */
const TESS_MAX_STEP_M = 5.0;

/**
 * Decide whether the solid-mode road layer should use the incremental per-road
 * upload path (vs the merged single-buffer fallback).
 *
 * Incremental upload must stay active even when the WASM project cache is not
 * ready, as long as no road needs regenerating (`changedRoadCount === 0`).
 * Otherwise a solid-mode re-render that does not push the cache would fall back
 * to the merged path, upload an empty merged buffer and destroy every per-road
 * GPU surface buffer — blanking out all road surfaces. The cache is only
 * required to (re)generate the changed roads.
 *
 * `roadsUnique` guards the per-road registry's hard requirement that every road
 * has a stable, unique id (the registry is keyed by id). Imported formats such
 * as GeoZ may produce duplicate or empty ids; those collapse in the keyed map
 * and would render only a subset of roads, so we fall back to the merged path
 * (which iterates roads positionally) for them.
 *
 * The first solid frame seeds the registry with ALL roads in one pass; later
 * frames only rebuild changed roads. A (re)build always requires `cacheReady`
 * so seeded per-road buffers carry real tessellated verts — a cold cache stays
 * merged, so the earlier first-frame-blank regression cannot recur. Completeness
 * (registry mesh count == road count) is enforced by the caller's self-heal
 * rebuild, not here, so a seed that lands mid-load converges instead of leaving
 * roads permanently unbuilt.
 */
export function shouldUseIncrementalRoads(params: {
  isSolid: boolean;
  supported: boolean;
  roadsUnique: boolean;
  registryActive: boolean;
  changedRoadCount: number;
  cacheReady: boolean;
}): boolean {
  const { isSolid, supported, roadsUnique, changedRoadCount, cacheReady } = params;
  if (!isSolid || !supported || !roadsUnique) return false;
  // Unchanged frame: keep the live registry even when the cache is cold.
  if (changedRoadCount === 0) return true;
  // Any (re)build (seed or delta) needs a ready cache so buffers are non-empty.
  return cacheReady;
}

/**
 * Decide whether the incremental path must rebuild ALL roads this frame (full
 * seed) vs only reference-changed roads (delta). Rebuild everything when the
 * palette changed, when the registry is not yet live (first seed), or when the
 * registry only partially covers the roads — the last case self-heals a seed
 * that landed mid-load (roads still streaming) so it converges to full coverage
 * rather than leaving most roads unbuilt.
 */
export function shouldRebuildAllRoads(params: {
  colorModeChanged: boolean;
  registryActive: boolean;
  registryMeshCount: number;
  roadsTotal: number;
}): boolean {
  const { colorModeChanged, registryActive, registryMeshCount, roadsTotal } = params;
  if (colorModeChanged) return true;
  if (!registryActive) return true;
  return registryMeshCount !== roadsTotal;
}

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
  /** Get the last-uploaded merged line vertices for existing roads (used by draw preview). */
  getCachedLineVertices: () => Float32Array;
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
  const cachedSpriteInstancesRef = useRef<Array<{ position: [number, number, number]; textureUrl: string; size: [number, number] }>>([]);
  const surfaceColorModeRef = useRef(display.colorMode);
  // True once the road layer is being driven incrementally (per-road GPU buffers).
  // Reset on file load and whenever we fall back to / leave the merged path, so the
  // next incremental upload rebuilds every road buffer from scratch.
  const incrementalRoadsActiveRef = useRef(false);

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

      // The renderer's road registry is the single source of truth for whether
      // the incremental layer is live. Consult it (not just our own ref) so that
      // any out-of-band merged upload that disposed the registry — e.g. the
      // geometry-edit drag preview, the SDK bridge, or a renderer re-mount —
      // forces a full rebuild here instead of leaving most roads unbuilt.
      const registryActive =
        typeof renderer.hasRoadRegistry === 'function'
          ? renderer.hasRoadRegistry()
          : incrementalRoadsActiveRef.current;
      const roadsTotal = visibleProject.roads.length;
      // Live registry buffer count — used to detect a partial seed (e.g. roads
      // still streaming in when the registry first seeded). When the per-road
      // buffers don't cover every road, force a full rebuild so a mid-load seed
      // converges instead of leaving most roads permanently unbuilt.
      const registryMeshCount =
        typeof renderer.getRoadMeshCount === 'function' ? renderer.getRoadMeshCount() : 0;
      const registryIncomplete = registryActive && registryMeshCount !== roadsTotal;

      // Granular invalidation:
      // - viewMode change does NOT require WASM regeneration (surfaces cached from solid mode)
      // - colorMode only affects road vertices
      // A partial registry seed (registryIncomplete) must also force a road regen so the
      // WASM cache is pushed and the self-heal full rebuild can produce real per-road verts.
      const needRoads = roadsChanged || colorModeChanged || registryIncomplete || cachedRoadVertsRef.current.length === 0;
      const needJunctions = junctionsChanged || roadsChanged || cachedJunctionVertsRef.current.length === 0;
      const needSignals = roadsChanged || junctionsChanged || cachedSignalVertsRef.current.length === 0;
      const needObjects = roadsChanged || junctionsChanged || cachedObjectVertsRef.current.length === 0;

      surfaceDepsRef.current = { roadRefs: newRoadRefs, junctionRefs: newJunctionRefs };
      surfaceColorModeRef.current = display.colorMode;

      // Per-road deltas for the incremental upload path.
      const removedRoadIds = [...prev.roadRefs.keys()].filter((id) => !newRoadRefs.has(id));
      // Rebuild every road when the colour mode changed (palette affects all roads),
      // when the incremental layer is not yet live (first solid frame / after a
      // merged-path fallback or registry disposal), or when the registry is only
      // partially seeded. Otherwise only roads whose object reference changed.
      const rebuildAllRoads = shouldRebuildAllRoads({
        colorModeChanged,
        registryActive,
        registryMeshCount,
        roadsTotal,
      });
      const changedRoadIds = rebuildAllRoads
        ? [...newRoadRefs.keys()]
        : [...newRoadRefs].filter(([id, ref]) => prev.roadRefs.get(id) !== ref).map(([id]) => id);
      // The per-road registry requires stable, unique, non-empty road ids.
      const roadsUnique =
        newRoadRefs.size === visibleProject.roads.length &&
        visibleProject.roads.every((r) => typeof r.id === 'string' && r.id.length > 0);

      // Only regenerate layers that actually need updating (always generate for solid cache)
      const empty = Promise.resolve(new Float32Array(0));

      // Make the WASM project cache authoritative for THIS frame before using the
      // serialization-free cached generators (road + object). The lifecycle effect also
      // pushes the cache, but its async timing relative to this callback is not guaranteed,
      // so pushing here guarantees the cached generators see exactly `visibleProject`.
      // On failure we simply fall back to the JSON-serialization paths below.
      let cacheReady = false;
      if (needRoads || needObjects) {
        try {
          await service.setProjectCache(visibleProject);
          cacheReady = true;
        } catch {
          cacheReady = false;
        }
      }

      // Incremental road upload requires: solid mode, renderer + service support.
      // The WASM cache (read by the per-road generator) is only needed when roads
      // actually have to be regenerated — see shouldUseIncrementalRoads.
      const useIncrementalRoads = shouldUseIncrementalRoads({
        isSolid: viewMode === 'solid',
        supported:
          typeof renderer.uploadRoadVerticesIncremental === 'function' &&
          typeof service.generateSingleRoadSurfaceVerticesCached === 'function',
        roadsUnique,
        registryActive,
        changedRoadCount: changedRoadIds.length,
        cacheReady,
      });

      // Road geometry — two strategies:
      //  • incremental: generate only the changed roads' surfaces (one buffer each)
      //  • merged: regenerate the whole road layer into a single array (fallback path)
      let perRoadVerts: Map<string, Float32Array> | null = null;
      let roadProm: Promise<Float32Array> = empty;
      if (useIncrementalRoads) {
        const singleGen = service.generateSingleRoadSurfaceVerticesCached;
        const built = await Promise.all(
          changedRoadIds.map((id) =>
            singleGen(id, TESS_MAX_STEP_M, display.colorMode)
              .catch(() => new Float32Array(0))
              .then((v) => [id, v] as const),
          ),
        );
        perRoadVerts = new Map(built);
      } else {
        // For road vertices: prefer the cached WASM fn (no JSON serialization) once the
        // cache is authoritative. Falls back to full-serialization path otherwise.
        roadProm = needRoads
          ? ((cacheReady && service.generateRoadVerticesCached)
              ? service.generateRoadVerticesCached(TESS_MAX_STEP_M, display.colorMode).catch(() =>
                  service.generateRoadVertices(visibleProject, TESS_MAX_STEP_M, display.colorMode))
              : service.generateRoadVertices(visibleProject, TESS_MAX_STEP_M, display.colorMode)
            ).catch((e) => { console.warn('[Viewport] generateRoadVertices failed:', e); return new Float32Array(0); })
          : empty;
      }
      const junctionProm = needJunctions
        ? service.generateJunctionVertices(visibleProject).catch((e) => { console.warn('[Viewport] generateJunctionVertices failed:', e); return new Float32Array(0); })
        : empty;
      const signalProm = needSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      // Object vertices: prefer the cached generator (no JSON serialization) when the cache
      // is authoritative; otherwise serialize the visible project as before.
      const objectProm = needObjects
        ? ((cacheReady && service.generateObjectVerticesCached)
            ? service.generateObjectVerticesCached().catch(() => service.generateObjectVertices(visibleProject))
            : service.generateObjectVertices(visibleProject)
          ).catch(() => new Float32Array(0))
        : empty;
      const spriteProm = (needSignals || needObjects)
        ? service.generateSpriteData(visibleProject).catch(() => ({ sprites: [], paints: [] } as SpriteDataResult))
        : Promise.resolve(null);

      const [roadVerts, junctionVerts, signalVerts, objectVerts, spriteData] = await Promise.all([
        roadProm, junctionProm, signalProm, objectProm, spriteProm,
      ]);

      // In incremental mode road geometry lives in per-road GPU buffers, not in this
      // merged CPU cache — leave it untouched so a later merged-path fallback rebuilds.
      if (needRoads && !useIncrementalRoads) cachedRoadVertsRef.current = roadVerts;
      if (needJunctions) cachedJunctionVertsRef.current = junctionVerts;
      if (needSignals) cachedSignalVertsRef.current = signalVerts;
      if (needObjects) cachedObjectVertsRef.current = objectVerts;

      // Merge visible layers — in non-solid mode, surfaces are hidden (not cleared)
      const tWasm = performance.now();
      let uploadedVertCount = 0;

      // Upload sprite data for textured billboard rendering
      if (spriteData && spriteData.sprites.length > 0 && display.showSignals) {
        const texMgr = renderer.getTextureManager();
        if (texMgr) {
          // Ensure manifest is loaded before resolving texture URLs
          await renderer.waitForManifest();

          const spriteInstances = spriteData.sprites.map((s) => ({
            position: s.pos as [number, number, number],
            textureUrl: texMgr.resolveSignalTexture(s.signal_type, s.subtype, s.value) ?? '',
            // Size in world units (meters). The renderer passes pixelsPerMeter as
            // sprite_scale so the billboard scales proportionally with zoom, just
            // like road geometry. Use at least 0.5 m to keep tiny signals visible.
            size: [
              Math.max(s.w, s.h, 0.5),
              Math.max(s.w, s.h, 0.5),
            ] as [number, number],
          })).filter((s) => s.textureUrl !== '');

          cachedSpriteInstancesRef.current = spriteInstances;
          if (spriteInstances.length > 0) {
            renderer.uploadSpriteData(spriteInstances);
          }
        }
      } else if (display.showSignals && cachedSpriteInstancesRef.current.length > 0) {
        // Re-upload cached sprite billboards when signals are toggled back on
        renderer.uploadSpriteData(cachedSpriteInstancesRef.current);
      } else if (!display.showSignals) {
        // Clear existing sprite billboards when signals are hidden
        renderer.uploadSpriteData([]);
      }

      if (viewMode !== 'solid') {
        // Wire/sketch: no surface polygons, just preserve last frame for smooth transition
        renderer.uploadRoadVertices(new Float32Array(0), { preserveLastVertexDataOnEmpty: true });
        renderer.uploadJunctionVertices(new Float32Array(0));
        // Leaving solid mode disposes the incremental registry — force a full
        // rebuild on the next solid frame.
        incrementalRoadsActiveRef.current = false;
      } else {
        // Junction fill is uploaded to its OWN layer (not merged into the road
        // surface buffer) so it can be drawn with the depth-biased pipeline,
        // avoiding z-fighting against the coplanar connecting-road surfaces in 3D.
        renderer.uploadJunctionVertices(cachedJunctionVertsRef.current);

        // Signals + objects share the "extras" buffer, drawn after the road segments.
        // Always include signal polygons (tessellated arrows + diamond markers);
        // billboard sprites render at z_offset=3.5+ above road, no z-fighting.
        let extras: Float32Array = new Float32Array(0);
        if (display.showSignals && cachedSignalVertsRef.current.length > 0) {
          extras = mergeFloat32Arrays(extras, cachedSignalVertsRef.current);
        }
        // Object vertices (crosswalks, parking spaces, guardrails, etc.)
        if (display.showObjects && cachedObjectVertsRef.current.length > 0) {
          extras = mergeFloat32Arrays(extras, cachedObjectVertsRef.current);
        }

        if (useIncrementalRoads && perRoadVerts) {
          const rebuilt = new Map<string, Float32Array>();
          let perRoadTotal = 0;
          for (const id of changedRoadIds) {
            const v = perRoadVerts.get(id) ?? new Float32Array(0);
            rebuilt.set(id, v);
            perRoadTotal += v.length;
          }
          // Self-heal: a full seed that produced no per-road geometry (e.g. the
          // cached single-road generator returned empty) would leave the solid
          // view blank. Fall back to the merged path so roads always render.
          if (rebuildAllRoads && perRoadTotal === 0 && roadsTotal > 0) {
            const merged = cacheReady && service.generateRoadVerticesCached
              ? await service.generateRoadVerticesCached(TESS_MAX_STEP_M, display.colorMode).catch(() => new Float32Array(0))
              : new Float32Array(0);
            let surfaceVerts = merged.length > 0 ? merged : cachedRoadVertsRef.current;
            if (extras.length > 0) surfaceVerts = mergeFloat32Arrays(surfaceVerts, extras);
            cachedRoadVertsRef.current = merged.length > 0 ? merged : cachedRoadVertsRef.current;
            uploadedVertCount = surfaceVerts.length / 7;
            renderer.uploadRoadVertices(surfaceVerts);
            incrementalRoadsActiveRef.current = false;
          } else {
            renderer.uploadRoadVerticesIncremental({ rebuilt, removed: removedRoadIds, extras });
            incrementalRoadsActiveRef.current = true;
            uploadedVertCount += perRoadTotal / 7 + extras.length / 7;
          }
        } else {
          let surfaceVerts = cachedRoadVertsRef.current;
          if (extras.length > 0) {
            surfaceVerts = mergeFloat32Arrays(surfaceVerts, extras);
          }
          uploadedVertCount = surfaceVerts.length / 7;
          renderer.uploadRoadVertices(surfaceVerts);
          incrementalRoadsActiveRef.current = false;
        }
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
  const lastUploadedLineVertsRef = useRef<Float32Array>(new Float32Array(0));
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
          service.generateCenterLineVertices(nonConnectorProject, TESS_MAX_STEP_M).catch(() => new Float32Array(0)),
          service.generateLaneBoundaryVertices(nonConnectorProject, TESS_MAX_STEP_M).catch(() => new Float32Array(0)),
          service.generateLaneLineVertices(nonConnectorProject, TESS_MAX_STEP_M).catch(() => new Float32Array(0)),
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
      lastUploadedLineVertsRef.current = lineVerts;
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
    // Clear sprite instances and flush GPU billboard state so stale sprites
    // from the previous project do not bleed into the new one.
    cachedSpriteInstancesRef.current = [];
    renderer?.uploadSpriteData([]);
    visibleProjectRef.current = null;
    visibleProjectKeyRef.current = '';
    surfaceDepsRef.current = { roadRefs: new Map(), junctionRefs: new Map() };
    cachedRoadVertsRef.current = new Float32Array(0);
    incrementalRoadsActiveRef.current = false;
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

  // ── Expose cached line vertices for draw preview ────────────────────────
  const getCachedLineVertices = useCallback((): Float32Array => {
    return lastUploadedLineVertsRef.current;
  }, []);

  // ── Trigger mesh updates when deps change ──────────────────────────────
  useEffect(() => { updateSurfaceMesh(); }, [updateSurfaceMesh]);
  useEffect(() => { updateLineMesh(); }, [updateLineMesh]);
  useEffect(() => { void updateOverlayMesh(); }, [updateOverlayMesh]);

  return { getVisibleProject, updateSurfaceMesh, updateLineMesh, updateOverlayMesh, getCachedLineVertices };
}
