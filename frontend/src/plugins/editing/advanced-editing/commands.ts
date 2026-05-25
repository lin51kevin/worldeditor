/**
 * Advanced Editing commands — all editing operations used by the plugin.
 */

import { useProjectStore } from '../../../stores/projectStore';
import { useViewportStore } from '../../../stores/viewportStore';
import { showAlert, showPrompt } from '../../../utils/dialog';
import i18next from 'i18next';
import { getPlatformService } from '../../../services';
import {
  attachRoadToJunction,
  chooseRoadConnectionContactPoint,
  cleanupJunctionsForRemovedRoads,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function t(key: string, fallback: string): string {
  return i18next.t(key, fallback);
}

export function getStore() {
  return useProjectStore.getState();
}

export function getSelectedJunctionState() {
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

// ─── Mode entry commands ────────────────────────────────────────────────────

export function enterSplitMode(): void {
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

export function enterSignalPlacementMode(): void {
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

export function enterObjectPlacementMode(): void {
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

export function addSignalHere(): void {
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

export function splitRoadAtJunction(): void {
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

export function autoDeploySidewalks(): void {
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

export function autoDeployCrosswalks(): void {
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

export function autoDeployStopLines(): void {
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

export function optimiseLaneGeometry(): void {
  const { selectedRoadId } = getStore();
  if (!selectedRoadId) {
    void showAlert(t('advancedEditing.noRoadSelected', 'No road selected'));
    return;
  }
  void showAlert(t('advancedEditing.requiresWasm', 'This feature requires WASM backend support and will be available in a future release'));
}

export function applyStandardMarkings(): void {
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

export function resampleSelectedRoad(): void {
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

export function addBridgeSection(): void {
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

export function addTunnelSection(): void {
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

export function weldRoads(): void {
  const { selectedRoadIds, project, executePluginCommand } = getStore();
  if (selectedRoadIds.length < 2) {
    void showAlert(t('advancedEditing.selectTwoRoads', 'Select at least 2 roads to weld'));
    return;
  }
  const [id1, id2] = selectedRoadIds;
  if (!id1 || !id2) {
    void showAlert(t('advancedEditing.selectTwoRoads', 'Select at least 2 roads to weld'));
    return;
  }
  const r1 = project.roads.find((r) => r.id === id1);
  const r2 = project.roads.find((r) => r.id === id2);
  if (!r1 || !r2) {
    void showAlert(t('advancedEditing.invalidRoadSelection', 'The specified road could not be found'));
    return;
  }

  try {
    executePluginCommand(
      t('advancedEditing.weldRoads', 'Weld Roads'),
      (p) => {
        const welded = weldRoadsUtil(r1, r2);
        return cleanupJunctionsForRemovedRoads({
          ...p,
          roads: p.roads.filter((r) => r.id !== id1 && r.id !== id2).concat([welded]),
        }, [id1, id2]);
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void showAlert(`${t('advancedEditing.weldRoadsFailed', 'Failed to weld roads: ')}${message}`);
  }
}

export function addIncomingRoadToJunction(): void {
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

export function removeIncomingRoadFromJunction(): void {
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

export function rebuildSelectedJunctionConnections(): void {
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

export function fillSelectedJunctionGap(): void {
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

export function buildJunctionPolygon(): void {
  const { selectedJunctionId } = getStore();
  if (!selectedJunctionId) {
    void showAlert(t('advancedEditing.noJunctionSelected', 'No junction selected'));
    return;
  }
  void showAlert(t('advancedEditing.requiresWasm', 'This feature requires WASM backend support and will be available in a future release'));
}
