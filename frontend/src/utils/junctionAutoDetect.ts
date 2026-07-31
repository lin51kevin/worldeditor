import type { Project, Road } from '../services/platform';

/** One road endpoint in world coordinates. */
export interface RoadEndpoint {
  roadId: string;
  contactPoint: 'start' | 'end';
  x: number;
  y: number;
}

/** Default clustering distance (metres) for detecting coincident endpoints. */
export const DEFAULT_JUNCTION_DETECT_THRESHOLD = 5;

/**
 * Return a road's start and end endpoints in world coordinates.
 *
 * The end point is approximated by extending the last plan-view segment along
 * its heading — exact for straight segments and close enough for clustering on
 * the curved stubs that typically terminate at an intersection.
 */
export function roadEndpoints(road: Road): RoadEndpoint[] {
  const segs = road.plan_view;
  if (segs.length === 0) return [];
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const endX = last.x + Math.cos(last.hdg) * last.length;
  const endY = last.y + Math.sin(last.hdg) * last.length;
  return [
    { roadId: road.id, contactPoint: 'start', x: first.x, y: first.y },
    { roadId: road.id, contactPoint: 'end', x: endX, y: endY },
  ];
}

/**
 * Detect clusters of nearby road endpoints that are candidates for a junction.
 *
 * Only roads not already assigned to a junction are considered. A cluster is
 * returned when it spans two or more distinct roads within `threshold` metres.
 */
export function detectJunctionClusters(
  project: Project,
  threshold: number = DEFAULT_JUNCTION_DETECT_THRESHOLD,
): RoadEndpoint[][] {
  const endpoints: RoadEndpoint[] = [];
  for (const road of project.roads) {
    if (road.junction_id) continue;
    endpoints.push(...roadEndpoints(road));
  }

  const clusters: RoadEndpoint[][] = [];
  const used = new Array(endpoints.length).fill(false);

  for (let i = 0; i < endpoints.length; i++) {
    if (used[i]) continue;
    const cluster = [endpoints[i]!];
    used[i] = true;
    // Grow the cluster transitively: re-scan whenever a member is added.
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < endpoints.length; j++) {
        if (used[j]) continue;
        const cand = endpoints[j]!;
        if (cluster.some((m) => Math.hypot(m.x - cand.x, m.y - cand.y) <= threshold)) {
          cluster.push(cand);
          used[j] = true;
          grew = true;
        }
      }
    }
    const roadSet = new Set(cluster.map((e) => e.roadId));
    if (roadSet.size >= 2) clusters.push(cluster);
  }

  return clusters;
}

/**
 * Reduce a cluster to one contact point per road (first occurrence wins),
 * ready to attach to a junction.
 */
export function clusterRoadContacts(cluster: RoadEndpoint[]): Array<{ roadId: string; contactPoint: 'start' | 'end' }> {
  const seen = new Map<string, 'start' | 'end'>();
  for (const ep of cluster) {
    if (!seen.has(ep.roadId)) seen.set(ep.roadId, ep.contactPoint);
  }
  return [...seen.entries()].map(([roadId, contactPoint]) => ({ roadId, contactPoint }));
}
