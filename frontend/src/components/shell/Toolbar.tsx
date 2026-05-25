import { useCallback, useRef, useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MousePointer,
  Route,
  MoveHorizontal,
  Square,
  Grid3x3,
  Box,
  Circle,
} from 'lucide-react';
import { resolveIcon } from '../shared/IconRenderer';
import { isDrawMode, useViewportStore } from '../../stores/viewportStore';
import { useProjectStore } from '../../stores/projectStore';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { STORAGE_KEYS } from '../../constants/storage';
import './Toolbar.css';

const STORAGE_KEY = STORAGE_KEYS.TOOLBAR_POS;

function loadPos(): { tx: number; ty: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as { tx: number; ty: number };
  } catch { /* ignore */ }
  return { tx: 0, ty: 0 };
}

export const Toolbar = memo(function Toolbar() {
  const {
    editMode,
    selectionMode,
    setEditMode,
    setSelectionMode,
    clearSplineKnots,
    viewMode,
    setViewMode,
  } = useViewportStore();

  // Subscribe so toolbar re-renders when selection changes (plugin buttons react to road/junction state)
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  // Intentionally consumed to ensure re-render on selection changes; values used implicitly by plugin buttons
  void selectedRoadId;
  void selectedJunctionId;

  const { toolbarButtons } = usePluginContribStore();

  const { t } = useTranslation();

  const initial = loadPos();
  const [tx, setTx] = useState(initial.tx);
  const [ty, setTy] = useState(initial.ty);
  const drag = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tx, ty })); } catch { /* ignore */ }
  }, [tx, ty]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setTx(drag.current.origTx + (e.clientX - drag.current.startX));
      setTy(drag.current.origTy + (e.clientY - drag.current.startY));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startY: e.clientY, origTx: tx, origTy: ty };
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  }, [tx, ty]);

  const handleButtonMouseDownCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, []);

  const visibleToolbarButtons = toolbarButtons.filter((button) => button.isVisible?.() ?? true);
  const pluginModeButtons = visibleToolbarButtons.filter((b) => b.group === 'mode');
  const pluginActionButtons = visibleToolbarButtons.filter((b) => b.group === 'action');

  const handleSelectionModeChange = useCallback((mode: 'road' | 'laneSection' | 'lane') => {
    if (isDrawMode(editMode)) {
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
  }, [clearSplineKnots, editMode, setEditMode, setSelectionMode]);

  return (
    <div
      className="toolbar"
      style={{ transform: `translateX(calc(-50% + ${tx}px)) translateY(${ty}px)` }}
      onMouseDownCapture={handleButtonMouseDownCapture}
      onMouseDown={handleMouseDown}
    >
      {/* SelectMode group */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${selectionMode === 'road' ? 'active' : ''}`}
          onClick={() => handleSelectionModeChange('road')}
          title={`${t('toolbar.roadEditTitle')} [1]`}
          aria-label={t('toolbar.roadEdit')}
          aria-pressed={selectionMode === 'road'}
        >
          <MousePointer size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.roadEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${selectionMode === 'laneSection' ? 'active' : ''}`}
          onClick={() => handleSelectionModeChange('laneSection')}
          title={`${t('toolbar.laneSectionEditTitle')} [2]`}
          aria-label={t('toolbar.laneSectionEdit')}
          aria-pressed={selectionMode === 'laneSection'}
        >
          <Grid3x3 size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.laneSectionEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${selectionMode === 'lane' ? 'active' : ''}`}
          onClick={() => handleSelectionModeChange('lane')}
          title={`${t('toolbar.laneEditTitle')} [3]`}
          aria-label={t('toolbar.laneEdit')}
          aria-pressed={selectionMode === 'lane'}
        >
          <MoveHorizontal size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.laneEdit')}</span>
        </button>
      </div>

      {/* Plugin mode buttons (EditMode: move-road, rotate-road, adjust-edge, road-markings) */}
      {pluginModeButtons.length > 0 && (
        <>
          <div className="toolbar-separator" />
          <div className="toolbar-group">
            {pluginModeButtons.map((btn) => (
              <button
                key={btn.id}
                className={`toolbar-btn toolbar-toggle ${btn.isActive?.() ? 'active' : ''}`}
                disabled={btn.isDisabled?.() ?? false}
                onClick={btn.onClick}
                title={t(btn.tooltipKey ?? btn.labelKey)}
              >
                <span className="tb-icon tb-plugin-icon">{resolveIcon(btn.icon)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* DrawMode group: spline / arc / spiral */}
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'spline' ? 'active' : ''}`}
          onClick={() => { setEditMode('spline'); clearSplineKnots(); }}
          title={t('toolbar.splineEditTitle')}
          aria-label={t('toolbar.splineEdit')}
          aria-pressed={editMode === 'spline'}
        >
          <Route size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.splineEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'drawArc' ? 'active' : ''}`}
          onClick={() => { setEditMode('drawArc'); clearSplineKnots(); }}
          title={t('toolbar.arcEditTitle')}
          aria-label={t('toolbar.arcEdit')}
          aria-pressed={editMode === 'drawArc'}
        >
          <Circle size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.arcEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'drawSpiral' ? 'active' : ''}`}
          onClick={() => { setEditMode('drawSpiral'); clearSplineKnots(); }}
          title={t('toolbar.spiralEditTitle')}
          aria-label={t('toolbar.spiralEdit')}
          aria-pressed={editMode === 'drawSpiral'}
        >
          <Route size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.spiralEdit')}</span>
        </button>
      </div>

      {/* Plugin action buttons (instant operations: clone, reverse, mirror…) */}
      {pluginActionButtons.length > 0 && (
        <>
          <div className="toolbar-separator" />
          <div className="toolbar-group">
            {pluginActionButtons.map((btn) => (
              <button
                key={btn.id}
                className="toolbar-btn"
                disabled={btn.isDisabled?.() ?? false}
                onClick={btn.onClick}
                title={t(btn.tooltipKey ?? btn.labelKey)}
              >
                <span className="tb-icon tb-plugin-icon">{resolveIcon(btn.icon)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* View mode group: sketch / wire / solid */}
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${viewMode === 'sketch' ? 'active' : ''}`}
          onClick={() => setViewMode('sketch')}
          title={t('toolbar.sketchTitle', 'Sketch (outline only)')}
          aria-label={t('toolbar.sketch', 'Sketch')}
          aria-pressed={viewMode === 'sketch'}
        >
          <Square size={16} className="tb-icon" />
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${viewMode === 'wire' ? 'active' : ''}`}
          onClick={() => setViewMode('wire')}
          title={t('toolbar.wireframeTitle', 'Wireframe (lane lines only)')}
          aria-label={t('toolbar.wireframe', 'Wireframe')}
          aria-pressed={viewMode === 'wire'}
        >
          <Grid3x3 size={16} className="tb-icon" />
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${viewMode === 'solid' ? 'active' : ''}`}
          onClick={() => setViewMode('solid')}
          title={t('toolbar.solidTitle', 'Solid (filled mesh)')}
          aria-label={t('toolbar.solid', 'Solid')}
          aria-pressed={viewMode === 'solid'}
        >
          <Box size={16} className="tb-icon" />
        </button>
      </div>

    </div>
  );
});

