/**
 * Unified snap/pick service — eliminates duplicated snap configuration and
 * query patterns scattered across Viewport.tsx, useSplineDrawMode, and
 * useViewportHoverPick.
 *
 * All snap queries go through this single service which owns the configuration
 * and error-handling strategy.
 */

import type { PlatformService, Project, SnapConfig, SnapResult, Road } from './platform';
import { getPlatformService } from './index';
import { useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { buildRenderableProject } from '../utils/sceneGraph';

/** Result from a hover-pick query (cascading road → junction → signal → object). */
export interface HoverPickResult {
  type: 'road' | 'junction' | 'signal' | 'object' | 'none';
  roadId?: string;
  junctionId?: string;
  signalId?: string;
  objectId?: string;
}

/** Result from a lane pick query. */
export interface LanePickResult {
  roadId: string;
  sectionIndex: number;
  laneId: number;
}

let cachedProjectRef: Project | null = null;
let cachedVisibilityKey = '';
let cachedRenderableProject: Project | null = null;
let snapCacheReady = false;

/** Build a SnapConfig from the current viewport store state. */
export function buildSnapConfig(): SnapConfig {
  const state = useViewportStore.getState();
  return {
    grid_enabled: state.snapToGrid,
    grid_size: state.gridSnapSize,
    endpoint_enabled: state.snapToEndpoints,
    endpoint_threshold: state.snapThreshold,
    snap_to_lane_endpoints: state.snapToLaneEndpoints,
    midpoint_enabled: state.snapToMidpoints,
    perpendicular_enabled: state.snapToPerpendicular,
  };
}

/** Build a draw-mode SnapConfig (endpoint-only, used during spline drawing). */
export function buildDrawSnapConfig(): SnapConfig {
  return {
    grid_enabled: false,
    grid_size: 1.0,
    endpoint_enabled: true,
    endpoint_threshold: 5.0,
    snap_to_lane_endpoints: false,
    midpoint_enabled: false,
    perpendicular_enabled: false,
  };
}

function buildVisibilityKey(): string {
  const { display } = useViewportStore.getState();
  return JSON.stringify({
    hiddenRoadIds: display.hiddenRoadIds,
    hiddenJunctionIds: display.hiddenJunctionIds,
    hiddenLaneSectionKeys: display.hiddenLaneSectionKeys,
    hiddenLaneKeys: display.hiddenLaneKeys,
    hiddenSignalKeys: display.hiddenSignalKeys,
    hiddenObjectKeys: display.hiddenObjectKeys,
  });
}

function getRenderableSnapProject(project: Project): Project {
  const visibilityKey = buildVisibilityKey();
  if (cachedProjectRef !== project || cachedVisibilityKey !== visibilityKey || !cachedRenderableProject) {
    cachedProjectRef = project;
    cachedVisibilityKey = visibilityKey;
    cachedRenderableProject = buildRenderableProject(project, useViewportStore.getState().display);
    snapCacheReady = false;
  }

  return cachedRenderableProject;
}

async function ensureSnapCache(service: PlatformService): Promise<void> {
  const { project } = useProjectStore.getState();
  const renderableProject = getRenderableSnapProject(project);
  if (snapCacheReady) return;

  await service.setProjectCache(renderableProject);
  snapCacheReady = true;
}

/**
 * Perform a cached snap query using the current viewport snap settings.
 * Returns null if snapping is disabled or the query fails silently.
 */
export async function querySnap(
  worldX: number,
  worldY: number,
  excludeRoadId?: string,
): Promise<SnapResult | null> {
  const { snapEnabled } = useViewportStore.getState();
  if (!snapEnabled) return null;

  try {
    const service = await getPlatformService();
    await ensureSnapCache(service);
    const result = await service.snapPointCached(worldX, worldY, buildSnapConfig(), excludeRoadId);
    return result.snapped ? result : null;
  } catch {
    return null;
  }
}

/**
 * Perform a draw-mode endpoint snap query.
 * Used while adding spline knots to detect endpoint proximity.
 */
export async function queryDrawSnap(
  worldX: number,
  worldY: number,
): Promise<SnapResult | null> {
  try {
    const service = await getPlatformService();
    await ensureSnapCache(service);
    const result = await service.snapPointCached(worldX, worldY, buildDrawSnapConfig());
    return result.snapped ? result : null;
  } catch {
    return null;
  }
}

/**
 * Snap a point onto a specific road's reference line.
 * Returns road-local coordinates {s, t, hdg}.
 */
export async function snapToRoad(
  road: Road,
  worldX: number,
  worldY: number,
): Promise<{ s: number; t: number; hdg: number } | null> {
  try {
    const service = await getPlatformService();
    return await service.snapPointOnRoad(road, worldX, worldY);
  } catch {
    return null;
  }
}

/**
 * Cascading hover-pick: road (2.5m) → junction (3m) → signal (4m) → object (4m).
 * Returns the first hit in priority order.
 */
export async function queryHoverPick(
  worldX: number,
  worldY: number,
): Promise<HoverPickResult> {
  try {
    const service = await getPlatformService();

    const roadId = await service.pickRoadAtPointCached(worldX, worldY, 2.5);
    if (roadId) return { type: 'road', roadId };

    const junctionId = await service.pickJunctionAtPointCached(worldX, worldY, 3.0);
    if (junctionId) return { type: 'junction', junctionId };

    const signalHit = await service.pickSignalAtPointCached(worldX, worldY, 4.0);
    if (signalHit) return { type: 'signal', roadId: signalHit.roadId, signalId: signalHit.signalId };

    const objectHit = await service.pickObjectAtPointCached(worldX, worldY, 4.0);
    if (objectHit) return { type: 'object', roadId: objectHit.roadId, objectId: objectHit.objectId };

    return { type: 'none' };
  } catch {
    return { type: 'none' };
  }
}

/**
 * Pick entities at click position with appropriate thresholds.
 * Signals/objects are checked first (4m) before roads (5m) to prevent
 * road picking always winning (signals sit ON roads).
 */
export async function queryClickPick(
  worldX: number,
  worldY: number,
): Promise<HoverPickResult> {
  try {
    const service = await getPlatformService();

    const signalHit = await service.pickSignalAtPointCached(worldX, worldY, 4.0);
    if (signalHit) return { type: 'signal', roadId: signalHit.roadId, signalId: signalHit.signalId };

    const objectHit = await service.pickObjectAtPointCached(worldX, worldY, 4.0);
    if (objectHit) return { type: 'object', roadId: objectHit.roadId, objectId: objectHit.objectId };

    const roadId = await service.pickRoadAtPointCached(worldX, worldY, 5.0);
    if (roadId) return { type: 'road', roadId };

    const junctionId = await service.pickJunctionAtPointCached(worldX, worldY, 8.0);
    if (junctionId) return { type: 'junction', junctionId };

    return { type: 'none' };
  } catch {
    return { type: 'none' };
  }
}

/**
 * Pick a road at a wider threshold (10m) — used for object placement.
 */
export async function pickRoadWide(
  worldX: number,
  worldY: number,
): Promise<string | null> {
  try {
    const service = await getPlatformService();
    return await service.pickRoadAtPointCached(worldX, worldY, 10.0);
  } catch {
    return null;
  }
}

/**
 * Pick a lane at the given world position.
 */
export async function pickLane(
  worldX: number,
  worldY: number,
): Promise<LanePickResult | null> {
  try {
    const service = await getPlatformService();
    return await service.pickLaneAtPointCached(worldX, worldY, 5.0);
  } catch {
    return null;
  }
}

/**
 * Pick a road at click threshold (5m).
 */
export async function pickRoad(
  worldX: number,
  worldY: number,
): Promise<string | null> {
  try {
    const service = await getPlatformService();
    return await service.pickRoadAtPointCached(worldX, worldY, 5.0);
  } catch {
    return null;
  }
}
