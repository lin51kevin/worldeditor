/**
 * Road Tools Plugin
 *
 * Contributes all 10 road editing tool buttons to the Toolbar and a Road menu
 * to the MenuBar. Call mountRoadToolsPlugin() once on app init; it returns a
 * cleanup function that removes all contributions on unmount.
 */
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { ToolbarButtonContrib, MenuItemContrib } from '../stores/pluginContribStore';
import { FlipHorizontal2, Sparkles, ArrowUpDown } from 'lucide-react';

const PLUGIN_ID = 'road-tools';

export function mountRoadToolsPlugin(): () => void {
  const { registerToolbarButton, registerMenuItem, unregisterPlugin } =
    usePluginContribStore.getState();

  // ── Toolbar: mode buttons ──────────────────────────────────────────────────
  const modeButtons: ToolbarButtonContrib[] = [
    {
      id: `${PLUGIN_ID}:move-road`,
      pluginId: PLUGIN_ID,
      icon: '⊕',
      labelKey: 'toolPanel.moveRoad',
      group: 'mode',
      isActive: () => useEditorViewStore.getState().editMode === 'move-road',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const vs = useEditorViewStore.getState();
        const entering = vs.editMode !== 'move-road';
        vs.setEditMode(entering ? 'move-road' : 'default');
      },
    },
    {
      id: `${PLUGIN_ID}:rotate-road`,
      pluginId: PLUGIN_ID,
      icon: '↺',
      labelKey: 'toolPanel.rotateRoad',
      group: 'mode',
      isActive: () => useEditorViewStore.getState().editMode === 'rotate-road',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const vs = useEditorViewStore.getState();
        const entering = vs.editMode !== 'rotate-road';
        vs.setEditMode(entering ? 'rotate-road' : 'default');
      },
    },
    {
      id: `${PLUGIN_ID}:adjust-edge`,
      pluginId: PLUGIN_ID,
      icon: '⊞',
      labelKey: 'toolPanel.adjustEdge',
      group: 'mode',
      isActive: () => false,
      isDisabled: () => true, // not yet implemented
      onClick: () => {},
    },
    {
      id: `${PLUGIN_ID}:edit-markings`,
      pluginId: PLUGIN_ID,
      icon: '▬',
      labelKey: 'toolPanel.editRoadMarkings',
      group: 'mode',
      isActive: () => false,
      isDisabled: () => true, // not yet implemented
      onClick: () => {},
    },
  ];

  // ── Toolbar: action buttons ────────────────────────────────────────────────
  const actionButtons: ToolbarButtonContrib[] = [
    {
      id: `${PLUGIN_ID}:clone`,
      pluginId: PLUGIN_ID,
      icon: '⧉',
      labelKey: 'toolPanel.cloneRoad',
      tooltipKey: 'toolPanel.cloneRoad',
      group: 'action',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, cloneRoad } = useEditorStore.getState();
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
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, reverseRoad } = useEditorStore.getState();
        if (selectedRoadId) reverseRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:mirror`,
      pluginId: PLUGIN_ID,
      icon: <FlipHorizontal2 size={14} />,
      labelKey: 'toolPanel.mirrorRoad',
      group: 'action',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, mirrorRoad } = useEditorStore.getState();
        if (selectedRoadId) mirrorRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:optimize`,
      pluginId: PLUGIN_ID,
      icon: <Sparkles size={14} />,
      labelKey: 'toolPanel.optimizeNode',
      group: 'action',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, optimizeRoad } = useEditorStore.getState();
        if (selectedRoadId) optimizeRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:swap-centerline`,
      pluginId: PLUGIN_ID,
      icon: <ArrowUpDown size={14} />,
      labelKey: 'toolPanel.swapCenterlineAndEdge',
      group: 'action',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, project, swapCenterline } = useEditorStore.getState();
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

  // ── Road menu contributions ────────────────────────────────────────────────
  const menuItems: MenuItemContrib[] = [
    {
      id: `${PLUGIN_ID}:menu-clone`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.cloneRoad',
      shortcut: 'Ctrl+D',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, cloneRoad } = useEditorStore.getState();
        if (!selectedRoadId) return;
        cloneRoad(selectedRoadId, `${selectedRoadId}-clone-${Date.now()}`, [20, 20]);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-reverse`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.reverseRoad',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, reverseRoad } = useEditorStore.getState();
        if (selectedRoadId) reverseRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-mirror`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.mirrorRoad',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, mirrorRoad } = useEditorStore.getState();
        if (selectedRoadId) mirrorRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-optimize`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.optimizeNode',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, optimizeRoad } = useEditorStore.getState();
        if (selectedRoadId) optimizeRoad(selectedRoadId);
      },
    },
    {
      id: `${PLUGIN_ID}:menu-swap`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: 'toolPanel.swapCenterlineAndEdge',
      isDisabled: () => !useEditorStore.getState().selectedRoadId,
      onClick: () => {
        const { selectedRoadId, project, swapCenterline } = useEditorStore.getState();
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
      id: `${PLUGIN_ID}:menu-sep`,
      pluginId: PLUGIN_ID,
      menu: 'road',
      labelKey: '',
      separator: true,
      onClick: () => {},
    },
  ];

  [...modeButtons, ...actionButtons].forEach(registerToolbarButton);
  menuItems.forEach(registerMenuItem);

  return () => unregisterPlugin(PLUGIN_ID);
}
