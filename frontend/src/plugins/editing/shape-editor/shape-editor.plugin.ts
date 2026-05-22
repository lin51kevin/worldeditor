/**
 * Shape Editor Plugin
 *
 * Provides a vector shape editing layer (Node / Way / Relation) for pre-road
 * geometry construction.  Users can:
 *  1. Create/manage shape layers.
 *  2. Place and move shape nodes on the viewport.
 *  3. Connect nodes into ways (polylines).
 *  4. Convert a selected way directly into an OpenDRIVE road.
 */

import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { useProjectStore } from '../../../stores/projectStore';
import { showAlert } from '../../../utils/dialog';
import i18next from 'i18next';
import type { ShapeLayer, ShapeNode, ShapeWay, Geometry } from '../../../services/platform';

const PLUGIN_ID = 'shape-editor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function t(key: string, fallback: string): string {
  return i18next.t(key, fallback);
}

function getStore() {
  return useProjectStore.getState();
}

/** Generate a simple incrementing ID with a prefix. */
function nextId(prefix: string, existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

// ─── Shape layer management ───────────────────────────────────────────────────

export function addShapeLayer(): void {
  const { project, executePluginCommand } = getStore();
  const existingIds = (project.shape_layers ?? []).map((l) => l.id);
  const id = nextId('layer', existingIds);
  const layer: ShapeLayer = {
    id,
    name: `${t('shapeEditor.layer', 'Layer')} ${existingIds.length + 1}`,
    visible: true,
    nodes: [],
    ways: [],
    relations: [],
  };
  executePluginCommand(t('shapeEditor.addLayer', 'Add Shape Layer'), (p) => ({
    ...p,
    shape_layers: [...(p.shape_layers ?? []), layer],
  }));
}

export function deleteShapeLayer(layerId: string): void {
  const { executePluginCommand } = getStore();
  executePluginCommand(t('shapeEditor.deleteLayer', 'Delete Shape Layer'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).filter((l) => l.id !== layerId),
  }));
}

export function toggleShapeLayerVisibility(layerId: string): void {
  const { executePluginCommand } = getStore();
  executePluginCommand(t('shapeEditor.toggleLayer', 'Toggle Layer Visibility'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== layerId ? l : { ...l, visible: !l.visible },
    ),
  }));
}

// ─── Node operations ──────────────────────────────────────────────────────────

/** Add a node to the active (first visible) shape layer. */
export function addShapeNode(x: number, y: number, layerId?: string): void {
  const { project, executePluginCommand } = getStore();
  const layers = project.shape_layers ?? [];
  const targetLayer = layerId
    ? layers.find((l) => l.id === layerId)
    : layers.find((l) => l.visible !== false);

  if (!targetLayer) {
    void showAlert(t('shapeEditor.noActiveLayer', 'No active shape layer. Create a layer first.'));
    return;
  }

  const nodeId = nextId('node', targetLayer.nodes.map((n) => n.id));
  const node: ShapeNode = { id: nodeId, x, y, z: 0 };

  executePluginCommand(t('shapeEditor.addNode', 'Add Shape Node'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== targetLayer.id ? l : { ...l, nodes: [...l.nodes, node] },
    ),
  }));
}

export function moveShapeNode(
  layerId: string,
  nodeId: string,
  newX: number,
  newY: number,
): void {
  const { executePluginCommand } = getStore();
  executePluginCommand(t('shapeEditor.moveNode', 'Move Shape Node'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== layerId
        ? l
        : {
            ...l,
            nodes: l.nodes.map((n) =>
              n.id !== nodeId ? n : { ...n, x: newX, y: newY },
            ),
          },
    ),
  }));
}

export function deleteShapeNode(layerId: string, nodeId: string): void {
  const { executePluginCommand } = getStore();
  executePluginCommand(t('shapeEditor.deleteNode', 'Delete Shape Node'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== layerId
        ? l
        : {
            ...l,
            nodes: l.nodes.filter((n) => n.id !== nodeId),
            // Remove deleted node from all ways.
            ways: l.ways.map((w) => ({
              ...w,
              node_ids: w.node_ids.filter((nid) => nid !== nodeId),
            })),
          },
    ),
  }));
}

// ─── Way operations ───────────────────────────────────────────────────────────

/** Create a new way connecting the given node IDs. */
export function addShapeWay(layerId: string, nodeIds: string[]): void {
  if (nodeIds.length < 2) {
    void showAlert(t('shapeEditor.wayNeedsNodes', 'A way needs at least 2 nodes.'));
    return;
  }
  const { project, executePluginCommand } = getStore();
  const layer = (project.shape_layers ?? []).find((l) => l.id === layerId);
  if (!layer) return;

  const wayId = nextId('way', layer.ways.map((w) => w.id));
  const way: ShapeWay = { id: wayId, node_ids: nodeIds, tags: [] };

  executePluginCommand(t('shapeEditor.addWay', 'Add Shape Way'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== layerId ? l : { ...l, ways: [...l.ways, way] },
    ),
  }));
}

export function deleteShapeWay(layerId: string, wayId: string): void {
  const { executePluginCommand } = getStore();
  executePluginCommand(t('shapeEditor.deleteWay', 'Delete Shape Way'), (p) => ({
    ...p,
    shape_layers: (p.shape_layers ?? []).map((l) =>
      l.id !== layerId ? l : { ...l, ways: l.ways.filter((w) => w.id !== wayId) },
    ),
  }));
}

// ─── Convert way → road ───────────────────────────────────────────────────────

/** Convert a shape way to an OpenDRIVE road. */
export function convertWayToRoad(layerId: string, wayId: string): void {
  const { project, executePluginCommand } = getStore();
  const layer = (project.shape_layers ?? []).find((l) => l.id === layerId);
  if (!layer) return;
  const way = layer.ways.find((w) => w.id === wayId);
  if (!way) return;

  const points: Array<[number, number]> = way.node_ids
    .map((nid) => layer.nodes.find((n) => n.id === nid))
    .filter((n): n is ShapeNode => n !== undefined)
    .map((n) => [n.x, n.y]);

  if (points.length < 2) {
    void showAlert(t('shapeEditor.wayNeedsNodes', 'A way needs at least 2 nodes.'));
    return;
  }

  const roadId = nextId('road', project.roads.map((r) => r.id));
  const nameTag = way.tags?.find((t) => t.key === 'name');
  const laneWidthTag = way.tags?.find((t) => t.key === 'lane_width');
  const laneWidth = laneWidthTag ? parseFloat(laneWidthTag.value) || 3.5 : 3.5;

  // Build piecewise-linear geometry.
  const geometries: Geometry[] = [];
  let totalS = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i] as [number, number];
    const [x1, y1] = points[i + 1] as [number, number];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.sqrt(dx * dx + dy * dy);
    const hdg = Math.atan2(dy, dx);
    geometries.push({ s: totalS, x: x0, y: y0, hdg, length, geo_type: 'Line' });
    totalS += length;
  }

  executePluginCommand(
    t('shapeEditor.convertToRoad', 'Convert Way to Road'),
    (p) => {
      // Build lane section with one driving lane.
      const laneSection: import('../../../services/platform').LaneSection = {
        s: 0,
        single_side: false,
        render_hidden: false,
        left: [],
        center: [{
          id: 0,
          lane_type: 'None',
          level: 0,
          render_hidden: false,
          link: null,
          width: [],
          borders: [],
          road_marks: [],
        }],
        right: [{
          id: -1,
          lane_type: 'Driving',
          level: 0,
          render_hidden: false,
          link: null,
          width: [{ s_offset: 0, a: laneWidth, b: 0, c: 0, d: 0 }],
          borders: [],
          road_marks: [{
            s_offset: 0,
            mark_type: 'Solid',
            weight: 'Standard',
            color: 'White',
            width: 0.15,
            lane_change: 'None',
            material: '',
          }],
        }],
      };

      const road: import('../../../services/platform').Road = {
        id: roadId,
        name: nameTag?.value ?? '',
        length: totalS,
        junction_id: null,
        link: null,
        plan_view: geometries,
        elevation_profile: [],
        lane_sections: [laneSection],
        bridges: [],
        tunnels: [],
        signals: [],
        objects: [],
      };

      return { ...p, roads: [...p.roads, road] };
    },
  );
}

// ─── Plugin registration ───────────────────────────────────────────────────────

export function mountShapeEditorPlugin(): () => void {
  const { registerMenuItem, unregisterPlugin } =
    usePluginContribStore.getState();

  registerMenuItem({
    id: `${PLUGIN_ID}.addLayer`,
    pluginId: PLUGIN_ID,
    label: t('shapeEditor.addLayer', 'Add Shape Layer'),
    labelKey: 'shapeEditor.addLayer',
    menu: 'edit',
    group: 'shape',
    onClick: addShapeLayer,
  });

  return () => {
    unregisterPlugin(PLUGIN_ID);
  };
}
