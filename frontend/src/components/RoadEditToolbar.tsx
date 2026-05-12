import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlipHorizontal2, Sparkles, ArrowUpDown } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import './RoadEditToolbar.css';

interface ToolDef {
  id: string;
  icon: ReactNode;
  labelKey: string;
  action: () => void;
  /** 'instant' = one-click operation; 'mode' = enters a persistent interaction mode */
  kind: 'instant' | 'mode';
  disabled?: boolean;
}

export function RoadEditToolbar() {
  const { t } = useTranslation();
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const project = useEditorStore((s) => s.project);
  const cloneRoad = useEditorStore((s) => s.cloneRoad);
  const reverseRoad = useEditorStore((s) => s.reverseRoad);
  const mirrorRoad = useEditorStore((s) => s.mirrorRoad);
  const optimizeRoad = useEditorStore((s) => s.optimizeRoad);
  const swapCenterline = useEditorStore((s) => s.swapCenterline);

  const { editMode, setEditMode, clearSplineKnots, softSelectionRadius, setSoftSelectionRadius } =
    useEditorViewStore();

  // Derive the active tool from the global editMode so the toolbar stays in sync
  // with the Toolbar plugin buttons (which also call setEditMode).
  const activeMode =
    editMode === 'spline' ? 'adjust-node' :
    editMode === 'move-road' ? 'move-road' :
    editMode === 'rotate-road' ? 'rotate-road' :
    editMode === 'adjust-edge' ? 'adjust-edge' :
    editMode === 'road-markings' ? 'edit-markings' :
    null;

  const selectedRoad = selectedRoadId
    ? project.roads.find((r) => r.id === selectedRoadId)
    : null;

  const handleClone = useCallback(() => {
    if (!selectedRoadId) return;
    const newId = `${selectedRoadId}-clone-${Date.now()}`;
    cloneRoad(selectedRoadId, newId, [20, 20]);
  }, [selectedRoadId, cloneRoad]);

  const handleReverse = useCallback(() => {
    if (selectedRoadId) reverseRoad(selectedRoadId);
  }, [selectedRoadId, reverseRoad]);

  const handleMirror = useCallback(() => {
    if (selectedRoadId) mirrorRoad(selectedRoadId);
  }, [selectedRoadId, mirrorRoad]);

  const handleOptimize = useCallback(() => {
    if (selectedRoadId) optimizeRoad(selectedRoadId);
  }, [selectedRoadId, optimizeRoad]);

  // Swap with the outermost left lane (id=1) by default; uses first lane section
  const handleSwapCenterline = useCallback(() => {
    if (!selectedRoadId) return;
    const road = project.roads.find((r) => r.id === selectedRoadId);
    if (!road) return;
    const sec = road.lane_sections[0];
    if (!sec) return;
    // Pick outermost left lane if available, otherwise outermost right
    const targetId = sec.left.length > 0
      ? Math.max(...sec.left.map((l) => l.id))
      : sec.right.length > 0
        ? Math.min(...sec.right.map((l) => l.id))
        : 0;
    if (targetId !== 0) swapCenterline(selectedRoadId, targetId);
  }, [selectedRoadId, project.roads, swapCenterline]);

  const tools: ToolDef[] = [
    {
      id: 'adjust-node',
      icon: '⌘',
      labelKey: 'toolPanel.adjustNode',
      kind: 'mode',
      // Activates the global Spline Edit mode for interactive knot dragging
      action: () => {
        const isEntering = editMode !== 'spline';
        setEditMode(isEntering ? 'spline' : 'select');
        if (isEntering) clearSplineKnots();
      },
    },
    {
      id: 'adjust-edge',
      icon: '⊞',
      labelKey: 'toolPanel.adjustEdge',
      kind: 'mode',
      action: () => {
        const isEntering = editMode !== 'adjust-edge';
        setEditMode(isEntering ? 'adjust-edge' : 'select');
      },
    },
    {
      id: 'move-road',
      icon: '⊕',
      labelKey: 'toolPanel.moveRoad',
      kind: 'mode',
      action: () => {
        const isEntering = editMode !== 'move-road';
        setEditMode(isEntering ? 'move-road' : 'select');
      },
    },
    {
      id: 'rotate-road',
      icon: '↺',
      labelKey: 'toolPanel.rotateRoad',
      kind: 'mode',
      action: () => {
        const isEntering = editMode !== 'rotate-road';
        setEditMode(isEntering ? 'rotate-road' : 'select');
      },
    },
    {
      id: 'optimize-node',
      icon: <Sparkles size={14} />,
      labelKey: 'toolPanel.optimizeNode',
      kind: 'instant',
      action: handleOptimize,
    },
    {
      id: 'edit-markings',
      icon: '▬',
      labelKey: 'toolPanel.editRoadMarkings',
      kind: 'mode',
      action: () => {
        const isEntering = editMode !== 'road-markings';
        setEditMode(isEntering ? 'road-markings' : 'select');
      },
    },
    {
      id: 'clone-road',
      icon: '⧉',
      labelKey: 'toolPanel.cloneRoad',
      kind: 'instant',
      action: handleClone,
    },
    {
      id: 'reverse-road',
      icon: '⇄',
      labelKey: 'toolPanel.reverseRoad',
      kind: 'instant',
      action: handleReverse,
    },
    {
      id: 'mirror-road',
      icon: <FlipHorizontal2 size={14} />,
      labelKey: 'toolPanel.mirrorRoad',
      kind: 'instant',
      action: handleMirror,
    },
    {
      id: 'swap-centerline',
      icon: <ArrowUpDown size={14} />,
      labelKey: 'toolPanel.swapCenterlineAndEdge',
      kind: 'instant',
      action: handleSwapCenterline,
    },
  ];

  return (
    <div className="road-edit-toolbar">
      <div className="road-edit-toolbar__header">
        {t('toolPanel.roadEditSection')}
      </div>

      {!selectedRoad ? (
        <div className="road-edit-toolbar__hint">
          {t('toolPanel.noRoadSelected')}
        </div>
      ) : (
        <>
          <div className="road-edit-toolbar__road-name">
            {selectedRoad.name || selectedRoad.id}
          </div>

          {/* Soft selection radius — visible when adjust-node mode is active */}
          {activeMode === 'adjust-node' && (
            <div className="road-edit-toolbar__soft-sel">
              <span className="road-edit-toolbar__soft-sel-label">
                {t('toolPanel.adjustNode')} — R
              </span>
              <input
                className="road-edit-toolbar__soft-sel-slider"
                type="range"
                min={1}
                max={500}
                step={1}
                value={softSelectionRadius}
                onChange={(e) => setSoftSelectionRadius(Number(e.target.value))}
                title={`Soft selection radius: ${softSelectionRadius.toFixed(0)} m`}
              />
              <span className="road-edit-toolbar__soft-sel-value">
                {softSelectionRadius.toFixed(0)} m
              </span>
            </div>
          )}

          {/* Top 4: mode tools */}
          <div className="road-edit-toolbar__group road-edit-toolbar__group--border">
            {tools.slice(0, 4).map((tool) => (
              <button
                key={tool.id}
                className={[
                  'road-edit-toolbar__btn',
                  tool.disabled ? 'road-edit-toolbar__btn--disabled' : '',
                  activeMode === tool.id ? 'road-edit-toolbar__btn--active' : '',
                ].join(' ')}
                title={t(tool.labelKey)}
                disabled={tool.disabled}
                onClick={tool.action}
              >
                <span className="road-edit-toolbar__icon">{tool.icon}</span>
                <span className="road-edit-toolbar__label">{t(tool.labelKey)}</span>
              </button>
            ))}
          </div>

          {/* Bottom 6: instant + more mode tools */}
          <div className="road-edit-toolbar__group">
            {tools.slice(4).map((tool) => (
              <button
                key={tool.id}
                className={[
                  'road-edit-toolbar__btn',
                  tool.disabled ? 'road-edit-toolbar__btn--disabled' : '',
                  activeMode === tool.id ? 'road-edit-toolbar__btn--active' : '',
                ].join(' ')}
                title={t(tool.labelKey)}
                disabled={tool.disabled}
                onClick={tool.action}
              >
                <span className="road-edit-toolbar__icon">{tool.icon}</span>
                <span className="road-edit-toolbar__label">{t(tool.labelKey)}</span>
                {tool.kind === 'instant' && (
                  <span className="road-edit-toolbar__badge">⚡</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
