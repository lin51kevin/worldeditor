import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';

// ── Component ──────────────────────────────────────────────────────────────

export function RoadEditToolbar() {
  const { t } = useTranslation();
  const editMode = useViewportStore((s) => s.editMode);
  const softSelectionRadius = useViewportStore((s) => s.softSelectionRadius);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const setEditMode = useViewportStore((s) => s.setEditMode);
  const clearSplineKnots = useViewportStore((s) => s.clearSplineKnots);
  const setSoftSelectionRadius = useViewportStore((s) => s.setSoftSelectionRadius);

  const isAdjustNodeActive = editMode === 'spline';
  const hasRoad = !!selectedRoadId;

  // ── Mode toggles ────────────────────────────────────────────────────────
  const handleAdjustNode = () => {
    if (isAdjustNodeActive) {
      setEditMode('default');
    } else {
      setEditMode('spline');
      clearSplineKnots();
    }
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

  return (
    <div className="road-edit-toolbar">
      <div className="road-edit-toolbar__header">
        {t('toolPanel.roadEditSection')}
      </div>

      {selectedRoad && (
        <div className="road-edit-toolbar__road-name">{selectedRoad.name}</div>
      )}

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
        <button
          className={`toolbar-btn ${editMode === 'move-road' ? 'active' : ''}`}
          title={`${t('toolPanel.moveRoad')} [M]`}
          onClick={() => setEditMode(editMode === 'move-road' ? 'default' : 'move-road')}
          disabled={!hasRoad}
        >
          {t('toolPanel.moveRoad')}
        </button>
        <button
          className={`toolbar-btn ${editMode === 'rotate-road' ? 'active' : ''}`}
          title={`${t('toolPanel.rotateRoad')} [R]`}
          onClick={() => setEditMode(editMode === 'rotate-road' ? 'default' : 'rotate-road')}
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
        <button
          className="toolbar-btn"
          title={t('toolPanel.editRoadMarkings')}
          disabled={!hasRoad}
        >
          {t('toolPanel.editRoadMarkings')}
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
      {isAdjustNodeActive && (
        <div className="road-edit-toolbar__soft-sel">
          <label>
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
