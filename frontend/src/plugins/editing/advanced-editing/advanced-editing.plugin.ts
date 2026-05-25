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
import { useViewportStore } from '../../../stores/viewportStore';
import type { MenuItemContrib, ToolbarButtonContrib, ContextMenuContrib, ContextMenuCtx } from '../../../stores/pluginContribStore';
import { showAlert, showPrompt } from '../../../utils/dialog';
import i18next from 'i18next';
import { getPlatformService } from '../../../services';
import {
  attachRoadToJunction,
  chooseRoadConnectionContactPoint,
  detachRoadFromJunction,
  fillJunctionConnectionGaps,
  getJunctionIncomingRoads,
  isRoadLinkedToJunction,
} from '../../../utils/junctionEditing';
import {
  splitRoadAt,
  weldRoads as weldRoadsUtil,
  deploySidewalks as deploySidewalksUtil,
  applyStandardMarkings as applyMarkingsUtil,
  deployCrosswalks as deployCrosswalksUtil,
  deployStopLines as deployStopLinesUtil,
  resampleRoad as resampleRoadUtil,
} from '../../../utils/roadEdit';
import {
  createRoadSignalFromPlacement,
  startObjectPlacement,
  startSignalPlacement,
} from '../../../hooks/useSignalPlacement';

const PLUGIN_ID = 'advanced-editing';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function t(key: string, fallback: string): string {
  return i18next.t(key, fallback);
}

function getStore() {
  return useProjectStore.getState();
}

function getSelectedJunctionState() {
  const store = getStore();
  if (!store.selectedJunctionId) {
    return null;
  }
  const junction = store.project.junctions.find((entry) => entry.id === store.selectedJunctionId);
  if (!junction) {
    return null;
  }
  return {
    ...store,
    junction,
    junctionId: store.selectedJunctionId,
  };
}

function formatRoadLabel(road: { id: string; name: string }): string {
  return road.name ? `${road.id} (${road.name})` : road.id;
}

async function promptForRoadId(
  roads: Array<{ id: string; name: string }>,
  messageKey: string,
  messageFallback: string,
  titleKey: string,
  titleFallback: string,
): Promise<string | null> {
  if (roads.length === 0) {
    return null;
  }

  const roadList = roads.map((road) => `• ${formatRoadLabel(road)}`).join('\n');
  const response = await showPrompt(
    `${t(messageKey, messageFallback)}\n\n${roadList}`,
    roads[0]?.id,
    t(titleKey, titleFallback),
  );
  return response?.trim() || null;
}

function enterSplitMode(): void {
  const { selectedRoadId } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }

  const viewportState = useViewportStore.getState();
  if (viewportState.editMode === 'spline' || viewportState.editMode === 'drawArc' || viewportState.editMode === 'drawSpiral') {
    viewportState.clearSplineKnots();
  }
  viewportState.setEditMode(viewportState.editMode === 'split' ? 'default' : 'split');
}

function enterSignalPlacementMode(): void {
  const viewportState = useViewportStore.getState();
  if (viewportState.editMode === 'placeSignal') {
    viewportState.setEditMode('default');
    return;
  }
  if (getStore().project.roads.length === 0) {
    return;
  }
  startSignalPlacement();
}

function enterObjectPlacementMode(): void {
  const viewportState = useViewportStore.getState();
  if (viewportState.editMode === 'placeObject') {
    viewportState.setEditMode('default');
    return;
  }
  if (getStore().project.roads.length === 0) {
    return;
  }
  startObjectPlacement();
}

function addSignalHere(): void {
  void (async () => {
    const { selectedRoadId, project, addRoadSignalItem, selectSignal, cursorWorldPos } = getStore();
    if (!selectedRoadId) {
      return;
    }

    const road = project.roads.find((candidate) => candidate.id === selectedRoadId);
    if (!road) {
      return;
    }

    const viewportState = useViewportStore.getState();
    const worldPos = viewportState.contextMenuWorldPos ?? cursorWorldPos;
    try {
      const service = await getPlatformService();
      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      const signal = createRoadSignalFromPlacement(viewportState.signalPlacementDraft, snap.s, snap.t);
      addRoadSignalItem(selectedRoadId, signal);
      selectSignal(selectedRoadId, signal.id);
    } catch (err) {
      console.error('[AdvancedEditing] Failed to add signal at context point:', err);
    }
  })();
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

/** Re-sample the selected road at a fixed interval and rebuild it as line segments. */
function resampleSelectedRoad(): void {
  const { selectedRoadId, executePluginCommand } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }

  void (async () => {
    const rawValue = await showPrompt(
      t('advancedEditing.resampleRoadPrompt', 'Enter resample segment length in metres'),
      '10',
      t('advancedEditing.resampleRoad', 'Resample Road'),
    );
    if (rawValue === null) {
      return;
    }

    const segmentLength = Number.parseFloat(rawValue);
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
      void showAlert(
        t('advancedEditing.invalidSegmentLength', 'Segment length must be a number greater than 0.'),
      );
      return;
    }

    executePluginCommand(
      t('advancedEditing.resampleRoad', 'Resample Road'),
      (p) => ({
        ...p,
        roads: p.roads.map((road) => (
          road.id === selectedRoadId ? resampleRoadUtil(road, segmentLength) : road
        )),
      }),
    );
  })();
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

/** Attach a road arm to the selected junction. */
function addIncomingRoadToJunction(): void {
  const junctionState = getSelectedJunctionState();
  if (!junctionState) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }

  const availableRoads = junctionState.project.roads.filter((road) => (
    road.junction_id !== junctionState.junctionId
    && (!road.link?.predecessor || !road.link?.successor)
    && !isRoadLinkedToJunction(road, junctionState.junctionId)
  ));
  if (availableRoads.length === 0) {
    void showAlert(t('advancedEditing.noAvailableRoads', 'No available roads to attach to this junction'));
    return;
  }

  void (async () => {
    const roadId = await promptForRoadId(
      availableRoads,
      'advancedEditing.addIncomingRoadPrompt',
      'Enter a road ID to attach to this junction',
      'advancedEditing.addIncomingRoad',
      'Add Incoming Road',
    );
    if (!roadId) {
      return;
    }

    const road = junctionState.project.roads.find((entry) => entry.id === roadId);
    if (!road) {
      void showAlert(t('advancedEditing.invalidRoadSelection', 'The specified road could not be found'));
      return;
    }

    const preferredContactPoint = chooseRoadConnectionContactPoint(junctionState.project, junctionState.junctionId, road);
    const candidateContactPoints = preferredContactPoint === 'Start' ? ['Start', 'End'] as const : ['End', 'Start'] as const;
    const contactPoint = candidateContactPoints.find((point) => {
      const link = point === 'Start' ? road.link?.predecessor : road.link?.successor;
      return !link || (link.element_type === 'Junction' && link.element_id === junctionState.junctionId);
    });

    if (!contactPoint) {
      void showAlert(t('advancedEditing.roadEndpointOccupied', 'The selected road already uses both endpoints'));
      return;
    }

    junctionState.executePluginCommand(
      t('advancedEditing.addIncomingRoad', 'Add Incoming Road'),
      (project) => attachRoadToJunction(project, junctionState.junctionId, road.id, contactPoint),
    );
  })();
}

/** Detach an incoming road arm from the selected junction. */
function removeIncomingRoadFromJunction(): void {
  const junctionState = getSelectedJunctionState();
  if (!junctionState) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }

  const incomingRoads = getJunctionIncomingRoads(junctionState.project, junctionState.junctionId);
  if (incomingRoads.length === 0) {
    void showAlert(t('advancedEditing.noIncomingRoads', 'No incoming roads are attached to this junction'));
    return;
  }

  void (async () => {
    const roadId = await promptForRoadId(
      incomingRoads,
      'advancedEditing.removeIncomingRoadPrompt',
      'Enter an incoming road ID to remove from this junction',
      'advancedEditing.removeIncomingRoad',
      'Remove Incoming Road',
    );
    if (!roadId) {
      return;
    }

    junctionState.executePluginCommand(
      t('advancedEditing.removeIncomingRoad', 'Remove Incoming Road'),
      (project) => detachRoadFromJunction(project, junctionState.junctionId, roadId),
    );
  })();
}

/** Rebuild connector roads for the selected junction. */
function rebuildSelectedJunctionConnections(): void {
  const junctionState = getSelectedJunctionState();
  if (!junctionState) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }

  const arms = junctionState.project.roads.filter((road) => isRoadLinkedToJunction(road, junctionState.junctionId));
  if (arms.length < 2) {
    void showAlert(t('advancedEditing.junctionNeedsArms', 'Junction needs at least 2 connected roads'));
    return;
  }

  void junctionState.rebuildJunctionConnections(junctionState.junctionId).catch((err) => {
    void showAlert(
      t('advancedEditing.autoBuildFailed', 'Auto-build failed: ') +
        String(err instanceof Error ? err.message : err),
    );
  });
}

/** Close connector/arm geometric gaps for the selected junction. */
function fillSelectedJunctionGap(): void {
  const junctionState = getSelectedJunctionState();
  if (!junctionState) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }

  if (junctionState.junction.connections.length === 0) {
    void showAlert(t('advancedEditing.noConnectionsToFill', 'No junction connections are available to fill'));
    return;
  }

  junctionState.executePluginCommand(
    t('advancedEditing.fillGap', 'Fill Gap'),
    (project) => fillJunctionConnectionGaps(project, junctionState.junctionId),
  );
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
      id: `${PLUGIN_ID}:split-road-point`,
      pluginId: PLUGIN_ID,
      icon: 'Scissors',
      labelKey: 'advancedEditing.splitRoadAtPoint',
      tooltipKey: 'advancedEditing.splitRoadAtPointTooltip',
      group: 'mode',
      isActive: () => useViewportStore.getState().editMode === 'split',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: enterSplitMode,
    },
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
    {
      id: `${PLUGIN_ID}:resample-road`,
      pluginId: PLUGIN_ID,
      icon: 'Ruler',
      labelKey: 'advancedEditing.resampleRoad',
      tooltipKey: 'advancedEditing.resampleRoadTooltip',
      group: 'action',
      isActive: () => false,
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: resampleSelectedRoad,
    },
    {
      id: `${PLUGIN_ID}:add-incoming-road`,
      pluginId: PLUGIN_ID,
      icon: 'Plus',
      labelKey: 'advancedEditing.addIncomingRoad',
      tooltipKey: 'advancedEditing.addIncomingRoadTooltip',
      group: 'action',
      isActive: () => false,
      isVisible: () => Boolean(useProjectStore.getState().selectedJunctionId),
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: addIncomingRoadToJunction,
    },
    {
      id: `${PLUGIN_ID}:remove-incoming-road`,
      pluginId: PLUGIN_ID,
      icon: 'Minus',
      labelKey: 'advancedEditing.removeIncomingRoad',
      tooltipKey: 'advancedEditing.removeIncomingRoadTooltip',
      group: 'action',
      isActive: () => false,
      isVisible: () => Boolean(useProjectStore.getState().selectedJunctionId),
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: removeIncomingRoadFromJunction,
    },
    {
      id: `${PLUGIN_ID}:rebuild-junction-connections`,
      pluginId: PLUGIN_ID,
      icon: 'RefreshCcw',
      labelKey: 'advancedEditing.rebuildConnections',
      tooltipKey: 'advancedEditing.rebuildConnectionsTooltip',
      group: 'action',
      isActive: () => false,
      isVisible: () => Boolean(useProjectStore.getState().selectedJunctionId),
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: rebuildSelectedJunctionConnections,
    },
    {
      id: `${PLUGIN_ID}:fill-junction-gap`,
      pluginId: PLUGIN_ID,
      icon: 'MoveHorizontal',
      labelKey: 'advancedEditing.fillGap',
      tooltipKey: 'advancedEditing.fillGapTooltip',
      group: 'action',
      isActive: () => false,
      isVisible: () => Boolean(useProjectStore.getState().selectedJunctionId),
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: fillSelectedJunctionGap,
    },
    {
      id: `${PLUGIN_ID}:place-signal`,
      pluginId: PLUGIN_ID,
      icon: 'PanelTop',
      labelKey: 'advancedEditing.placeSignal',
      group: 'mode',
      isActive: () => useViewportStore.getState().editMode === 'placeSignal',
      isDisabled: () => useProjectStore.getState().project.roads.length === 0,
      onClick: enterSignalPlacementMode,
    },
    {
      id: `${PLUGIN_ID}:place-object`,
      pluginId: PLUGIN_ID,
      icon: 'TrafficCone',
      labelKey: 'advancedEditing.placeObject',
      group: 'mode',
      isActive: () => useViewportStore.getState().editMode === 'placeObject',
      isDisabled: () => useProjectStore.getState().project.roads.length === 0,
      onClick: enterObjectPlacementMode,
    },
  ];

  toolbarButtons.forEach((btn) => registerToolbarButton(btn));

  // ── Menu items ─────────────────────────────────────────────────────────────
  const menuItems: MenuItemContrib[] = [
    // Road menu group
    {
      id: `${PLUGIN_ID}:split-road-point-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.splitRoadAtPoint',
      label: 'Split Road at Point',
      group: 'advanced',
      shortcut: 'X',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: enterSplitMode,
    },
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
      id: `${PLUGIN_ID}:resample-road-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.resampleRoad',
      label: 'Resample Road…',
      group: 'advanced',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: resampleSelectedRoad,
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
    {
      id: `${PLUGIN_ID}:place-signal-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.placeSignal',
      label: 'Place Signal',
      group: 'advanced',
      isDisabled: () => useProjectStore.getState().project.roads.length === 0,
      onClick: enterSignalPlacementMode,
    },
    {
      id: `${PLUGIN_ID}:place-object-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.placeObject',
      label: 'Place Object',
      group: 'advanced',
      isDisabled: () => useProjectStore.getState().project.roads.length === 0,
      onClick: enterObjectPlacementMode,
    },
    // Junction menu group
    {
      id: `${PLUGIN_ID}:add-incoming-road-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.addIncomingRoad',
      label: 'Add Incoming Road…',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: addIncomingRoadToJunction,
    },
    {
      id: `${PLUGIN_ID}:remove-incoming-road-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.removeIncomingRoad',
      label: 'Remove Incoming Road…',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: removeIncomingRoadFromJunction,
    },
    {
      id: `${PLUGIN_ID}:rebuild-junction-connections-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.rebuildConnections',
      label: 'Rebuild Connections',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: rebuildSelectedJunctionConnections,
    },
    {
      id: `${PLUGIN_ID}:fill-junction-gap-menu`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.fillGap',
      label: 'Fill Gap',
      group: 'junction',
      isDisabled: () => !useProjectStore.getState().selectedJunctionId,
      onClick: fillSelectedJunctionGap,
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
      labelKey: 'advancedEditing.splitRoadAtPoint',
      label: 'Split Road at Point',
      shortcut: 'X',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'road',
      onClick: enterSplitMode,
    },
    {
      id: `${PLUGIN_ID}:ctx-resample-road`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.resampleRoad',
      label: 'Resample Road…',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'road',
      onClick: resampleSelectedRoad,
    },
    {
      id: `${PLUGIN_ID}:ctx-add-signal-here`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'advancedEditing.addSignalHere',
      label: 'Add Signal Here',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'road',
      onClick: addSignalHere,
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
      id: `${PLUGIN_ID}:ctx-add-incoming-road`,
      pluginId: PLUGIN_ID,
      menu: 'junction',
      labelKey: 'advancedEditing.addIncomingRoad',
      label: 'Add Incoming Road…',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'junction',
      onClick: addIncomingRoadToJunction,
    },
    {
      id: `${PLUGIN_ID}:ctx-remove-incoming-road`,
      pluginId: PLUGIN_ID,
      menu: 'junction',
      labelKey: 'advancedEditing.removeIncomingRoad',
      label: 'Remove Incoming Road…',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'junction',
      onClick: removeIncomingRoadFromJunction,
    },
    {
      id: `${PLUGIN_ID}:ctx-rebuild-connections`,
      pluginId: PLUGIN_ID,
      menu: 'junction',
      labelKey: 'advancedEditing.rebuildConnections',
      label: 'Rebuild Connections',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'junction',
      onClick: rebuildSelectedJunctionConnections,
    },
    {
      id: `${PLUGIN_ID}:ctx-fill-gap`,
      pluginId: PLUGIN_ID,
      menu: 'junction',
      labelKey: 'advancedEditing.fillGap',
      label: 'Fill Gap',
      isVisible: (ctx?: ContextMenuCtx) => ctx?.type === 'junction',
      onClick: fillSelectedJunctionGap,
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

