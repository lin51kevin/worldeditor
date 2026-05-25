/**
 * Road Tools Plugin
 *
 * Contributes all 10 road editing tool buttons to the Toolbar and a Road menu
 * to the MenuBar. Call mountRoadToolsPlugin() once on app init; it returns a
 * cleanup function that removes all contributions on unmount.
 */
import { useProjectStore } from '../../../stores/projectStore';
import { useViewportStore } from '../../../stores/viewportStore';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import type { ToolbarButtonContrib, MenuItemContrib } from '../../../stores/pluginContribStore';
import { finalizeGeometryEditStandalone } from '../../../hooks/useSplineOperations';
import { FlipHorizontal2, Sparkles, ArrowUpDown } from 'lucide-react';

const PLUGIN_ID = 'road-tools';

export function mountRoadToolsPlugin(): () => void {
  const { registerToolbarButton, registerMenuItem, unregisterPlugin } =
    usePluginContribStore.getState();

  // ── Toolbar: action buttons (clone/reverse/mirror/optimize/swap) ───────────
  const actionButtons: ToolbarButtonContrib[] = [
    {
      id: `${PLUGIN_ID}:clone`,
      pluginId: PLUGIN_ID,
      icon: '⧉',
      labelKey: 'toolPanel.cloneRoad',
      tooltipKey: 'toolPanel.cloneRoad',
      group: 'action',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, cloneRoad } = useProjectStore.getState();
        if (!selectedRoadId) return;
        cloneRoad(selectedRoadId, `${selectedRoadId}-clone-${Date.now()}`, [20, 20]);
      },
    },
    {
      id: `${PLUGIN_ID}:reverse`,
      pluginId: PLUGIN_ID,
      icon: '⇄',
      labelKey: 'toolPanel.reverseRoad',
      group: 'action',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, reverseRoad } = useProjectStore.getState();
        if (selectedRoadId) reverseRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:mirror`,
      pluginId: PLUGIN_ID,
      icon: <FlipHorizontal2 size={14} />,
      labelKey: 'toolPanel.mirrorRoad',
      group: 'action',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, mirrorRoad } = useProjectStore.getState();
        if (selectedRoadId) mirrorRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:optimize`,
      pluginId: PLUGIN_ID,
      icon: <Sparkles size={14} />,
      labelKey: 'toolPanel.optimizeNode',
      group: 'action',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, optimizeRoad } = useProjectStore.getState();
        if (selectedRoadId) optimizeRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:swap-centerline`,
      pluginId: PLUGIN_ID,
      icon: <ArrowUpDown size={14} />,
      labelKey: 'toolPanel.swapCenterlineAndEdge',
      group: 'action',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, project, swapCenterline } = useProjectStore.getState();
        if (!selectedRoadId) return;
        const road = project.roads.find((r) => r.id === selectedRoadId);
        if (!road) return;
        const sec = road.lane_sections[0];
        if (!sec) return;
        const targetId =
          sec.left.length > 0
            ? Math.max(...sec.left.map((l) => l.id))
            : sec.right.length > 0
              ? Math.min(...sec.right.map((l) => l.id))
              : 0;
        if (targetId !== 0) swapCenterline(selectedRoadId, targetId);
      },
    },
  ];

  actionButtons.forEach(registerToolbarButton);

  // ── Road menu contributions ────────────────────────────────────────────────
  const menuItems: MenuItemContrib[] = [
    {
      id: `${PLUGIN_ID}:menu-draw-arc`,
      pluginId: PLUGIN_ID,
      menu: 'tools',
      labelKey: 'toolPanel.drawArcRoad',
      shortcut: 'A',
      onClick: () => {
        const vs = useViewportStore.getState();
        if (vs.geometryEditRoadId) {
          void finalizeGeometryEditStandalone();
        }
        vs.clearSplineKnots();
        vs.setEditMode('drawArc');
      },
    },
    {
      id: `${PLUGIN_ID}:menu-clone`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.cloneRoad',
      shortcut: 'Ctrl+D',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, cloneRoad } = useProjectStore.getState();
        if (!selectedRoadId) return;
        cloneRoad(selectedRoadId, `${selectedRoadId}-clone-${Date.now()}`, [20, 20]);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-reverse`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.reverseRoad',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, reverseRoad } = useProjectStore.getState();
        if (selectedRoadId) reverseRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-mirror`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.mirrorRoad',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, mirrorRoad } = useProjectStore.getState();
        if (selectedRoadId) mirrorRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-optimize`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.optimizeNode',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, optimizeRoad } = useProjectStore.getState();
        if (selectedRoadId) optimizeRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-swap`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.swapCenterlineAndEdge',
      isDisabled: () => !useProjectStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, project, swapCenterline } = useProjectStore.getState();
        if (!selectedRoadId) return;
        const road = project.roads.find((r) => r.id === selectedRoadId);
        if (!road) return;
        const sec = road.lane_sections[0];
        if (!sec) return;
        const targetId =
          sec.left.length > 0
            ? Math.max(...sec.left.map((l) => l.id))
            : sec.right.length > 0
              ? Math.min(...sec.right.map((l) => l.id))
              : 0;
        if (targetId !== 0) swapCenterline(selectedRoadId, targetId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-draw-spiral`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolbar.spiralEdit',
      shortcut: 'P',
      onClick: () => {
        const vs = useViewportStore.getState();
        vs.clearSplineKnots();
        vs.setEditMode('drawSpiral');
      },
    },
    {
      id: `${PLUGIN_ID}:menu-sep`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: '',
      separator: true,
      onClick: () => {},
    },
  ];

  // Mode and action buttons are only shown in RoadEditToolbar panel (not floating toolbar).
  // Only register menu items for keyboard/menu access.
  menuItems.forEach(registerMenuItem);

  return () => unregisterPlugin(PLUGIN_ID);
}
