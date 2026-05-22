/**
 * Advanced Editing Plugin
 *
 * Provides advanced road/lane/junction editing operations beyond the 34 core commands.
 * All operations use executeWithUndo() for full undo/redo support.
 *
 * Features:
 * 1.  Road splitting with junction creation
 * 2.  Auto-build connecting roads at junction
 * 3.  Junction polygon builder / triangulator
 * 4.  Weld/connect roads
 * 5.  Auto-deploy lane markings (sidewalks, crosswalks, stop lines, etc.)
 * 6.  Standard marking setup + driving side config
 * 7.  Lane optimisation (smooth, remove redundant knots)
 * 8.  Lane-to-lane connectivity builder
 * 9.  Road mark merge/cut/standardise
 * 10. Zone operations (build, clear, convert)
 * 11. Route/path planning
 * 12. Bridge/tunnel creation commands
 * 13. CRG profile support (attach, detach)
 */

import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { useProjectStore } from '../../../stores/projectStore';
import type { MenuItemContrib, ToolbarButtonContrib, ContextMenuContrib, ContextMenuCtx } from '../../../stores/pluginContribStore';
import { showAlert } from '../../../utils/dialog';
import i18next from 'i18next';
import { getPlatformService } from '../../../services';
import {
  splitRoadAt,
  weldRoads as weldRoadsUtil,
  deploySidewalks as deploySidewalksUtil,
  applyStandardMarkings as applyMarkingsUtil,
  deployCrosswalks as deployCrosswalksUtil,
  deployStopLines as deployStopLinesUtil,
} from '../../../utils/roadEdit';

const PLUGIN_ID = 'advanced-editing';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function t(key: string, fallback: string): string {
  return i18next.t(key, fallback);
}

function getStore() {
  return useProjectStore.getState();
}

// ─── Feature implementations ───────────────────────────────────────────────────

/** Split a road at its midpoint, creating two half-roads and a junction between them. */
function splitRoadAtJunction(): void {
  const { selectedRoadId, project, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  const road = project.roads.find((r) => r.id === selectedRoadId);
  if (!road || road.length < 2.0) {
    void showAlert(t('advancedEditing.roadTooShort', 'Road is too short to split'));
    return;
  }
  const splitS = road.length / 2;
  executePluginCommand(
    t('advancedEditing.splitRoad', 'Split Road'),
    (p) => {
      const { road1, road2, junction } = splitRoadAt(road, splitS);
      return {
        ...p,
        roads: p.roads.filter((r) => r.id !== selectedRoadId).concat([road1, road2]),
        junctions: [...p.junctions, junction],
      };
    },
  );
}

/** Auto-deploy standard sidewalks on the selected road. */
function autoDeploySidewalks(): void {
  const { selectedRoadId, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.autoDeploySidewalks', 'Auto-Deploy Sidewalks'),
    (p) => ({
      ...p,
      roads: p.roads.map((r) => (r.id === selectedRoadId ? deploySidewalksUtil(r) : r)),
    }),
  );
}

/** Auto-deploy crosswalks at the selected junction. */
function autoDeployCrosswalks(): void {
  const { selectedJunctionId, executePluginCommand } = getStore();
  if (!selectedJunctionId) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.autoDeployCrosswalks', 'Auto-Deploy Crosswalks'),
    (p) => deployCrosswalksUtil(p, selectedJunctionId),
  );
}

/** Auto-deploy stop lines at the selected junction. */
function autoDeployStopLines(): void {
  const { selectedJunctionId, executePluginCommand } = getStore();
  if (!selectedJunctionId) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.autoDeployStopLines', 'Auto-Deploy Stop Lines'),
    (p) => deployStopLinesUtil(p, selectedJunctionId),
  );
}

/** Optimise lane geometry (smooth and de-duplicate knots). */
function optimiseLaneGeometry(): void {
  const { selectedRoadId } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  void showAlert(t('advancedEditing.requiresWasm', 'This feature requires WASM backend support and will be available in a future release'));
}

/** Apply standard road markings (centre line, edge lines, etc.). */
function applyStandardMarkings(): void {
  const { selectedRoadId, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.applyStandardMarkings', 'Apply Standard Markings'),
    (p) => ({
      ...p,
      roads: p.roads.map((r) => (r.id === selectedRoadId ? applyMarkingsUtil(r) : r)),
    }),
  );
}

/** Add a bridge section to the selected road. */
function addBridgeSection(): void {
  const { selectedRoadId, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.addBridge', 'Add Bridge Section'),
    (p) => {
      return {
        ...p,
        roads: p.roads.map((road) => {
          if (road.id !== selectedRoadId) return road;
          const bridge = {
            id: `bridge-${Date.now()}`,
            s: 0.0,
            length: Math.min(road.length, 20.0),
            bridge_type: 'concrete',
          };
          return { ...road, bridges: [...(road.bridges ?? []), bridge] };
        }),
      };
    },
  );
}

/** Add a tunnel section to the selected road. */
function addTunnelSection(): void {
  const { selectedRoadId, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  executePluginCommand(
    t('advancedEditing.addTunnel', 'Add Tunnel Section'),
    (p) => {
      return {
        ...p,
        roads: p.roads.map((road) => {
          if (road.id !== selectedRoadId) return road;
          const tunnel = {
            id: `tunnel-${Date.now()}`,
            s: 0.0,
            length: Math.min(road.length, 30.0),
            tunnel_type: 'underpass',
          };
          return { ...road, tunnels: [...(road.tunnels ?? []), tunnel] };
        }),
      };
    },
  );
}

/** Weld two selected roads together at their endpoints. */
function weldRoads(): void {
  const { selectedRoadIds, project, executePluginCommand } = getStore();
  if (selectedRoadIds.length < 2) {
    void showAlert(t('advancedEditing.selectTwoRoads', 'Select at least 2 roads to weld'));
    return;
  }
  const [id1, id2] = selectedRoadIds;
  const r1 = project.roads.find((r) => r.id === id1);
  const r2 = project.roads.find((r) => r.id === id2);
  if (!r1 || !r2) return;
  executePluginCommand(
    t('advancedEditing.weldRoads', 'Weld Roads'),
    (p) => {
      const welded = weldRoadsUtil(r1, r2);
      return {
        ...p,
        roads: p.roads.filter((r) => r.id !== id1 && r.id !== id2).concat([welded]),
      };
    },
  );
}

/** Auto-build connecting roads between junctions. */
function autoBuildConnectingRoads(): void {
  const { selectedJunctionId, project } = getStore();
  if (!selectedJunctionId) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }
  // Check arms exist before calling WASM
  const arms = project.roads.filter(
    (r) =>
      r.link?.successor?.element_id === selectedJunctionId ||
      r.link?.predecessor?.element_id === selectedJunctionId,
  );
  if (arms.length < 2) {
    void showAlert(t('advancedEditing.junctionNeedsArms', 'Junction needs at least 2 connected roads'));
    return;
  }
  const junctionId = selectedJunctionId;
  void (async () => {
    try {
      const service = await getPlatformService();
      const updated = await service.autoJunctionConnectors(project, junctionId);
      useProjectStore.getState().executePluginCommand(
        t('advancedEditing.autoBuildConnecting', 'Auto-Build Junction Connectors'),
        () => updated,
      );
    } catch (err) {
      void showAlert(
        t('advancedEditing.autoBuildFailed', 'Auto-build failed: ') +
          String(err instanceof Error ? err.message : err),
      );
    }
  })();
}

/** Build a junction polygon for the selected junction. */
function buildJunctionPolygon(): void {
  const { selectedJunctionId } = getStore();
  if (!selectedJunctionId) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }
  void showAlert(t('advancedEditing.requiresWasm', 'This feature requires WASM backend support and will be available in a future release'));
}

// ─── Plugin registration ───────────────────────────────────────────────────────

/** Mount the Advanced Editing plugin. Returns a cleanup function. */
export function mountAdvancedEditingPlugin(): () => void {
  const store = usePluginContribStore.getState();
  const { registerToolbarButton, registerMenuItem, registerContextMenuItem, unregisterPlugin } =
    store;

  // ── Toolbar buttons ──────────────────────────────────────────────────────
  const toolbarButtons: ToolbarButtonContrib[] = [
    {
      id: `${PLUGIN_ID}:split-road`,
      pluginId: PLUGIN_ID,
      icon: 'Scissors',
      labelKey: 'advancedEditing.splitRoad',
      group: 'action',
      isActive: () => false,
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: splitRoadAtJunction,
    },
    {
      id: `${PLUGIN_ID}:weld-roads`,
      pluginId: PLUGIN_ID,
      icon: 'Link2',
      labelKey: 'advancedEditing.weldRoads',
      group: 'action',
      isActive: () => false,
      isDisabled: () => useProjectStore.getState().selectedRoadIds.length < 2,
      onClick: weldRoads,
    },
  ];

  toolbarButtons.forEach((btn) => registerToolbarButton(btn));

  // ── Menu items ─────────────────────────────────────────────────────────────
  const menuItems: MenuItemContrib[] = [
    // Road menu group
    {
      id: `${PLUGIN_ID}:split-road-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.splitRoad',
      label: 'Split Road at Midpoint…',
      group: 'advanced',
      shortcut: 'Ctrl+Shift+X',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: splitRoadAtJunction,
    },
    {
      id: `${PLUGIN_ID}:weld-roads-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.weldRoads',
      label: 'Weld Roads…',
      group: 'advanced',
      isDisabled: () => useProjectStore.getState().selectedRoadIds.length < 2,
      onClick: weldRoads,
    },
    {
      id: `${PLUGIN_ID}:optimise-lanes`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.optimiseLanes',
      label: 'Optimise Lane Geometry',
      group: 'advanced',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: optimiseLaneGeometry,
    },
    {
      id: `${PLUGIN_ID}:apply-markings`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.applyStandardMarkings',
      label: 'Apply Standard Markings',
      group: 'advanced',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: applyStandardMarkings,
    },
    // Junction menu group
    {
      id: `${PLUGIN_ID}:auto-build-connecting`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.autoBuildConnecting',
      label: 'Auto-Build Connecting Roads…',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: autoBuildConnectingRoads,
    },
    {
      id: `${PLUGIN_ID}:build-junction-polygon`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.buildJunctionPolygon',
      label: 'Build Junction Polygon',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: buildJunctionPolygon,
    },
    // Deploy submenu
    {
      id: `${PLUGIN_ID}:deploy-sidewalks`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.autoDeploySidewalks',
      label: 'Auto-Deploy Sidewalks',
      group: 'deploy',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: autoDeploySidewalks,
    },
    {
      id: `${PLUGIN_ID}:deploy-crosswalks`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.autoDeployCrosswalks',
      label: 'Auto-Deploy Crosswalks',
      group: 'deploy',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: autoDeployCrosswalks,
    },
    {
      id: `${PLUGIN_ID}:deploy-stop-lines`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.autoDeployStopLines',
      label: 'Auto-Deploy Stop Lines',
      group: 'deploy',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: autoDeployStopLines,
    },
    // Bridge/Tunnel submenu
    {
      id: `${PLUGIN_ID}:add-bridge`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.addBridge',
      label: 'Add Bridge Section',
      group: 'infrastructure',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: addBridgeSection,
    },
    {
      id: `${PLUGIN_ID}:add-tunnel`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.addTunnel',
      label: 'Add Tunnel Section',
      group: 'infrastructure',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: addTunnelSection,
    },
  ];

  menuItems.forEach((item) => registerMenuItem(item));

  // ── Context menu items ─────────────────────────────────────────────────────
  const contextMenuItems: ContextMenuContrib[] = [
    {
      id: `${PLUGIN_ID}:ctx-split-road`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.splitRoad',
      label: 'Split Road Here',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'road',
      onClick: splitRoadAtJunction,
    },
    {
      id: `${PLUGIN_ID}:ctx-add-bridge`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.addBridge',
      label: 'Add Bridge Section',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'road',
      onClick: addBridgeSection,
    },
    {
      id: `${PLUGIN_ID}:ctx-build-polygon`,
      pluginId: PLUGIN_ID,
      menu: 'junction',
      labelKey: 'advancedEditing.buildJunctionPolygon',
      label: 'Build Junction Polygon',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'junction',
      onClick: buildJunctionPolygon,
    },
  ];

  contextMenuItems.forEach((item) => registerContextMenuItem(item));

  // Cleanup
  return () => {
    unregisterPlugin(PLUGIN_ID);
  };
}

