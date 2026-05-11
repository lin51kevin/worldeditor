import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MousePointer, Route, AlignJustify, GitMerge,
  Spline, Grid, Crosshair,
  Magnet, Ruler,
} from 'lucide-react';
import { useEditorViewStore } from '../stores/editorViewStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import './Toolbar.css';

const STORAGE_KEY = 'we-toolbar-pos';

function loadPos(): { tx: number; ty: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as { tx: number; ty: number };
  } catch { /* ignore */ }
  return { tx: 0, ty: 0 };
}

export function Toolbar() {
  const {
    dimension,
    showGrid,
    showAxis,
    editMode,
    snapEnabled,
    measureMode,
    setDimension,
    toggleGrid,
    toggleAxis,
    setEditMode,
    toggleSnap,
    setMeasureMode,
    clearSplineKnots,
  } = useEditorViewStore();
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

  const handleSplineMode = useCallback(() => {
    setEditMode('spline');
    clearSplineKnots();
  }, [setEditMode, clearSplineKnots]);

  return (
    <div
      className="toolbar"
      style={{ transform: `translateX(calc(-50% + ${tx}px)) translateY(${ty}px)` }}
      onMouseDown={handleMouseDown}
    >
      {/* Edit mode */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'select' ? 'active' : ''}`}
          onClick={() => setEditMode('select')}
          title={t('toolbar.selectModeTitle')}
        >
          <MousePointer size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.selectMode')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'road' ? 'active' : ''}`}
          onClick={() => setEditMode('road')}
          title={t('toolbar.roadEditTitle')}
        >
          <Route size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.roadEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'spline' ? 'active' : ''}`}
          onClick={handleSplineMode}
          title={t('toolbar.splineEditTitle')}
        >
          <Spline size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.splineEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'lane' ? 'active' : ''}`}
          onClick={() => setEditMode('lane')}
          title={t('toolbar.laneEditTitle')}
        >
          <AlignJustify size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.laneEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'junction' ? 'active' : ''}`}
          onClick={() => setEditMode('junction')}
          title={t('toolbar.junctionEditTitle')}
        >
          <GitMerge size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.junctionEdit')}</span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* 3D/2D */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${dimension === '3d' ? 'active' : ''}`}
          onClick={() => { setDimension('3d'); emitViewportEvent({ type: 'set-dimension', dimension: '3d' }); }}
          title={t('toolbar.view3dTitle')}
        >
          <span className="tb-dim-label">3D</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${dimension === '2d' ? 'active' : ''}`}
          onClick={() => { setDimension('2d'); emitViewportEvent({ type: 'set-dimension', dimension: '2d' }); }}
          title={t('toolbar.view2dTitle')}
        >
          <span className="tb-dim-label">2D</span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Grid/Axis toggles */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${showGrid ? 'active' : ''}`}
          onClick={() => { const newVal = !showGrid; toggleGrid(); emitViewportEvent({ type: 'set-show-grid', show: newVal }); }}
          title={t('toolbar.gridTitle')}
        >
          <Grid size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.grid')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${showAxis ? 'active' : ''}`}
          onClick={() => { const newVal = !showAxis; toggleAxis(); emitViewportEvent({ type: 'set-show-axis', show: newVal }); }}
          title={t('toolbar.axisTitle')}
        >
          <Crosshair size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.axis')}</span>
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Snap / Measure */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${snapEnabled ? 'active' : ''}`}
          onClick={toggleSnap}
          title={t('toolbar.snapTitle')}
        >
          <Magnet size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.snap')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${measureMode !== 'none' ? 'active' : ''}`}
          onClick={() => setMeasureMode(measureMode !== 'none' ? 'none' : 'distance')}
          title={t('toolbar.measureTitle')}
        >
          <Ruler size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.measure')}</span>
        </button>
      </div>
    </div>
  );
}
