import { useCallback, useRef, useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Route,
  Circle,
  Move,
  RotateCw,
} from 'lucide-react';
import { resolveIcon } from '../shared/IconRenderer';
import { useViewportStore } from '../../stores/viewportStore';
import { useProjectStore } from '../../stores/projectStore';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { finalizeGeometryEditStandalone } from '../../hooks/useSplineOperations';
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
    setEditMode,
    clearSplineKnots,
  } = useViewportStore();

  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);

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
  const pluginActionButtons = visibleToolbarButtons.filter((b) => b.group === 'action');

  const handleMoveRoad = useCallback(() => {
    const vs = useViewportStore.getState();
    if (vs.geometryEditRoadId) {
      void finalizeGeometryEditStandalone();
    }
    const entering = vs.editMode !== 'move-road';
    vs.setEditMode(entering ? 'move-road' : 'default');
  }, []);

  const handleRotateRoad = useCallback(() => {
    const vs = useViewportStore.getState();
    if (vs.geometryEditRoadId) {
      void finalizeGeometryEditStandalone();
    }
    const entering = vs.editMode !== 'rotate-road';
    vs.setEditMode(entering ? 'rotate-road' : 'default');
  }, []);

  return (
    <div
      className="toolbar"
      style={{ transform: `translateX(calc(-50% + ${tx}px)) translateY(${ty}px)` }}
      onMouseDownCapture={handleButtonMouseDownCapture}
      onMouseDown={handleMouseDown}
    >
      {/* DrawMode group: spline / arc / spiral */}
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

      {/* Edit mode group: move / rotate */}
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'move-road' ? 'active' : ''}`}
          onClick={handleMoveRoad}
          disabled={!selectedRoadId}
          title={t('toolPanel.moveRoad', 'Move Road')}
          aria-label={t('toolPanel.moveRoad', 'Move Road')}
          aria-pressed={editMode === 'move-road'}
        >
          <Move size={16} className="tb-icon" />
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'rotate-road' ? 'active' : ''}`}
          onClick={handleRotateRoad}
          disabled={!selectedRoadId}
          title={t('toolPanel.rotateRoad', 'Rotate Road')}
          aria-label={t('toolPanel.rotateRoad', 'Rotate Road')}
          aria-pressed={editMode === 'rotate-road'}
        >
          <RotateCw size={16} className="tb-icon" />
        </button>
      </div>

      {/* Plugin action buttons (split, weld, resample — contextual tools) */}
      {pluginActionButtons.length > 0 && (
        <>
          <div className="toolbar-separator" />
          <div className="toolbar-group">
            {pluginActionButtons.map((btn) => (
              <button
                key={btn.id}
                className={`toolbar-btn ${btn.isActive?.() ? 'active' : ''}`}
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

    </div>
  );
});

