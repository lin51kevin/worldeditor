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
import {
  enterSplitMode,
  enterSignalPlacementMode,
  enterObjectPlacementMode,
  addSignalHere,
  splitRoadAtJunction,
  autoDeploySidewalks,
  autoDeployCrosswalks,
  autoDeployStopLines,
  optimiseLaneGeometry,
  applyStandardMarkings,
  resampleSelectedRoad,
  addBridgeSection,
  addTunnelSection,
  weldRoads,
  addIncomingRoadToJunction,
  removeIncomingRoadFromJunction,
  rebuildSelectedJunctionConnections,
  fillSelectedJunctionGap,
  buildJunctionPolygon,
} from './commands';

const PLUGIN_ID = 'advanced-editing';


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
      labelKey: 'advancedEditing.splitRoad',
      tooltipKey: 'advancedEditing.splitRoadAtPointTooltip',
      group: 'action',
      isActive: () => useViewportStore.getState().editMode === 'split',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: enterSplitMode,
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
      icon: 'AudioWaveform',
      labelKey: 'advancedEditing.resampleRoad',
      tooltipKey: 'advancedEditing.resampleRoadTooltip',
      group: 'action',
      isActive: () => false,
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: resampleSelectedRoad,
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

