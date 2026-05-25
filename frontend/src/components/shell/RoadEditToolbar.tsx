import { useTranslation } from 'react-i18next';
import { Grid3x3, MousePointer, MoveHorizontal } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { useSplineOperations } from '../../hooks/useSplineOperations';

// ── Component ──────────────────────────────────────────────────────────────

export function RoadEditToolbar() {
  const { t } = useTranslation();
  const editMode = useViewportStore((s) => s.editMode);
  const selectionMode = useViewportStore((s) => s.selectionMode);
  const softSelectionRadius = useViewportStore((s) => s.softSelectionRadius);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const setEditMode = useViewportStore((s) => s.setEditMode);
  const setSelectionMode = useViewportStore((s) => s.setSelectionMode);
  const clearSplineKnots = useViewportStore((s) => s.clearSplineKnots);
  const setSoftSelectionRadius = useViewportStore((s) => s.setSoftSelectionRadius);
  const geometryEditRoadId = useViewportStore((s) => s.geometryEditRoadId);
  const { finalizeGeometryEdit } = useSplineOperations();

  const isAdjustNodeActive = editMode === 'spline';
  const isLaneLineEditActive = editMode === 'editLaneLine';
  const hasRoad = !!selectedRoadId;
  const hasSelectedLane = selectedSceneNode?.type === 'lane';

  // ── Mode toggles ────────────────────────────────────────────────────────
  const handleAdjustNode = () => {
    if (isAdjustNodeActive) {
      setEditMode('default');
    } else {
      // If in geometry edit, finalize before entering spline draw mode
      if (geometryEditRoadId) void finalizeGeometryEdit();
      setEditMode('spline');
      clearSplineKnots();
    }
  };

  const handleMoveRoad = () => {
    const next = editMode === 'move-road' ? 'default' : 'move-road';
    if (geometryEditRoadId) void finalizeGeometryEdit();
    setEditMode(next);
  };

  const handleRotateRoad = () => {
    const next = editMode === 'rotate-road' ? 'default' : 'rotate-road';
    if (geometryEditRoadId) void finalizeGeometryEdit();
    setEditMode(next);
  };

  const handleEditLaneLine = () => {
    if (isLaneLineEditActive) {
      setEditMode('default');
      return;
    }
    if (!hasSelectedLane) {
      return;
    }
    if (geometryEditRoadId) void finalizeGeometryEdit();
    if (editMode === 'spline' || editMode === 'drawArc' || editMode === 'drawSpiral') {
      clearSplineKnots();
    }
    setEditMode('editLaneLine');
  };

  const handleSelectionModeChange = (mode: 'road' | 'laneSection' | 'lane') => {
    if (editMode === 'spline' || editMode === 'drawArc' || editMode === 'drawSpiral') {
      clearSplineKnots();
    }
    if (editMode !== 'default') {
      setEditMode('default');
    }

    const projectState = useProjectStore.getState();
    if (mode === 'road') {
      projectState.clearLaneSelection();
    } else if (mode === 'laneSection' && projectState.selectedRoadId && projectState.selectedLaneSectionIndex !== null) {
      projectState.setSelectedLaneSection(projectState.selectedRoadId, projectState.selectedLaneSectionIndex);
    }

    setSelectionMode(mode);
  };

  // ── Instant road actions ─────────────────────────────────────────────────
  const handleClone = () => {
    if (!selectedRoadId) return;
    const newId = `${selectedRoadId}-clone-${Date.now()}`;
    useProjectStore.getState().cloneRoad(selectedRoadId, newId, [5, 5]);
    useProjectStore.getState().selectRoad(newId);
  };

  const handleReverse = () => {
    if (!selectedRoadId) return;
    useProjectStore.getState().reverseRoad(selectedRoadId);
  };

  const handleMirror = () => {
    if (!selectedRoadId) return;
    useProjectStore.getState().mirrorRoad(selectedRoadId);
  };

  const handleSwapCenterline = () => {
    if (!selectedRoadId) return;
    const project = useProjectStore.getState().project;
    const road = project.roads.find((r) => r.id === selectedRoadId);
    if (!road) return;
    const section = road.lane_sections[0];
    if (!section) return;

    const leftLanes = section.left;
    const rightLanes = section.right;

    let targetLaneId: number | null = null;
    if (leftLanes.length > 0) {
      targetLaneId = Math.max(...leftLanes.map((l) => l.id));
    } else if (rightLanes.length > 0) {
      targetLaneId = Math.min(...rightLanes.map((l) => l.id));
    }

    if (targetLaneId !== null) {
      useProjectStore.getState().swapCenterline(selectedRoadId, targetLaneId);
    }
  };

  // ── Road name ────────────────────────────────────────────────────────────
  const project = useProjectStore((s) => s.project);
  const selectedRoad = project?.roads?.find((r) => r.id === selectedRoadId) ?? null;

  const handleButtonMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };

  return (
    <div className="road-edit-toolbar" onMouseDownCapture={handleButtonMouseDownCapture}>
      <div className="road-edit-toolbar__header">
        {t('toolPanel.roadEditSection')}
      </div>

      {selectedRoad && (
        <div className="road-edit-toolbar__road-name">{selectedRoad.name}</div>
      )}

      <div className="road-edit-toolbar__group road-edit-toolbar__group--border">
        <button
          className={`road-edit-toolbar__btn ${selectionMode === 'road' ? 'road-edit-toolbar__btn--active' : ''}`}
          title={`${t('toolPanel.selectionModes.road')} [1]`}
          onClick={() => handleSelectionModeChange('road')}
          disabled={!hasRoad}
          aria-pressed={selectionMode === 'road'}
        >
          <MousePointer size={14} className="road-edit-toolbar__icon" />
          <span className="road-edit-toolbar__label">{t('toolPanel.selectionModes.road')}</span>
          <span className="road-edit-toolbar__badge">1</span>
        </button>
        <button
          className={`road-edit-toolbar__btn ${selectionMode === 'laneSection' ? 'road-edit-toolbar__btn--active' : ''}`}
          title={`${t('toolPanel.selectionModes.laneSection')} [2]`}
          onClick={() => handleSelectionModeChange('laneSection')}
          disabled={!hasRoad}
          aria-pressed={selectionMode === 'laneSection'}
        >
          <Grid3x3 size={14} className="road-edit-toolbar__icon" />
          <span className="road-edit-toolbar__label">{t('toolPanel.selectionModes.laneSection')}</span>
          <span className="road-edit-toolbar__badge">2</span>
        </button>
        <button
          className={`road-edit-toolbar__btn ${selectionMode === 'lane' ? 'road-edit-toolbar__btn--active' : ''}`}
          title={`${t('toolPanel.selectionModes.lane')} [3]`}
          onClick={() => handleSelectionModeChange('lane')}
          disabled={!hasRoad}
          aria-pressed={selectionMode === 'lane'}
        >
          <MoveHorizontal size={14} className="road-edit-toolbar__icon" />
          <span className="road-edit-toolbar__label">{t('toolPanel.selectionModes.lane')}</span>
          <span className="road-edit-toolbar__badge">3</span>
        </button>
      </div>

      {!hasRoad && (
        <div className="road-edit-toolbar__hint">
          {t('toolPanel.noRoadSelected')}
        </div>
      )}

      {/* Mode buttons — always shown; disabled when no road is selected */}
      <div className="road-edit-toolbar__mode-group">
        <button
          className={`toolbar-btn ${isAdjustNodeActive ? 'active' : ''}`}
          title={t('toolPanel.adjustNode')}
          onClick={handleAdjustNode}
          disabled={!hasRoad}
        >
          {t('toolPanel.adjustNode')}
        </button>
        <button
          className="toolbar-btn"
          title={t('toolPanel.adjustEdge')}
          disabled={!hasRoad}
        >
          {t('toolPanel.adjustEdge')}
        </button>
        {selectionMode === 'lane' && (
          <button
            className={`toolbar-btn ${isLaneLineEditActive ? 'active' : ''}`}
            title={t('toolPanel.editLaneLine')}
            onClick={handleEditLaneLine}
            disabled={!hasSelectedLane}
          >
            {t('toolPanel.editLaneLine')}
          </button>
        )}
        <button
          className={`toolbar-btn ${editMode === 'move-road' ? 'active' : ''}`}
          title={`${t('toolPanel.moveRoad')} [M]`}
          onClick={handleMoveRoad}
          disabled={!hasRoad}
        >
          {t('toolPanel.moveRoad')}
        </button>
        <button
          className={`toolbar-btn ${editMode === 'rotate-road' ? 'active' : ''}`}
          title={`${t('toolPanel.rotateRoad')} [R]`}
          onClick={handleRotateRoad}
          disabled={!hasRoad}
        >
          {t('toolPanel.rotateRoad')}
        </button>
        <button
          className="toolbar-btn"
          title={t('toolPanel.optimizeNode')}
          onClick={() => selectedRoadId && useProjectStore.getState().optimizeRoad(selectedRoadId)}
          disabled={!hasRoad}
        >
          {t('toolPanel.optimizeNode')}
        </button>
      </div>

      {/* Action buttons — only when a road is selected */}
      {hasRoad && (
        <div className="road-edit-toolbar__action-group">
          <button className="toolbar-btn" title={t('toolPanel.cloneRoad')} onClick={handleClone}>
            {t('toolPanel.cloneRoad')}
          </button>
          <button className="toolbar-btn" title={t('toolPanel.reverseRoad')} onClick={handleReverse}>
            {t('toolPanel.reverseRoad')}
          </button>
          <button className="toolbar-btn" title={t('toolPanel.mirrorRoad')} onClick={handleMirror}>
            {t('toolPanel.mirrorRoad')}
          </button>
          <button className="toolbar-btn" title={t('toolPanel.swapCenterlineAndEdge')} onClick={handleSwapCenterline}>
            {t('toolPanel.swapCenterlineAndEdge')}
          </button>
        </div>
      )}

      {/* Soft selection radius — visible only when adjust-node (spline) mode is active */}
      {(isAdjustNodeActive || isLaneLineEditActive) && (
        <div className="road-edit-toolbar__soft-sel">
          <label className="road-edit-toolbar__soft-sel-label">
            {t('toolPanel.softSelectionRadius', { radius: softSelectionRadius.toFixed(0) })}
          </label>
          <input
            type="range"
            className="road-edit-toolbar__soft-sel-slider"
            min={1}
            max={200}
            step={1}
            value={softSelectionRadius}
            onChange={(e) => setSoftSelectionRadius(Number(e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
