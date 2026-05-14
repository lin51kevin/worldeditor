import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MousePointer,
  Spline, Minus, Circle, Waves,
} from 'lucide-react';
import { useEditorViewStore } from '../../stores/editorViewStore';
import type { DrawMode } from '../../stores/editorViewStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePluginContribStore } from '../../stores/pluginContribStore';
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
    editMode,
    setEditMode,
    clearSplineKnots,
  } = useEditorViewStore();

  // Subscribe so toolbar re-renders when selectedRoadId changes (plugin buttons may react to selection state)
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  // Intentionally consumed to ensure re-render on selection changes; value used implicitly by plugin buttons
  void selectedRoadId;

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

  const handleDrawMode = useCallback((mode: DrawMode) => {
    setEditMode(mode);
    clearSplineKnots();
  }, [setEditMode, clearSplineKnots]);

  // Subscribe so toolbar re-renders when selectedRoadId changes (used by plugin buttons that read selection state)
  // Note: selectedRoadId is intentionally subscribed even if not directly referenced here

  const pluginModeButtons = toolbarButtons.filter((b) => b.group === 'mode');
  const pluginActionButtons = toolbarButtons.filter((b) => b.group === 'action');

  return (
    <div
      className="toolbar"
      style={{ transform: `translateX(calc(-50% + ${tx}px)) translateY(${ty}px)` }}
      onMouseDown={handleMouseDown}
    >
      {/* SelectMode group: only default/select — road/lane/lanesection hidden for now */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'default' ? 'active' : ''}`}
          onClick={() => { setEditMode('default'); clearSplineKnots(); }}
          title={t('toolbar.selectModeTitle')}
          aria-label={t('toolbar.selectMode')}
          aria-pressed={editMode === 'default'}
        >
          <MousePointer size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.selectMode')}</span>
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
                <span className="tb-icon tb-plugin-icon">{btn.icon}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* DrawMode group: line / arc / spline / spiral */}
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'line' ? 'active' : ''}`}
          onClick={() => handleDrawMode('line')}
          title={t('toolbar.drawLineTitle')}
        >
          <Minus size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.drawLine')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'arc' ? 'active' : ''}`}
          onClick={() => handleDrawMode('arc')}
          title={t('toolbar.drawArcTitle')}
        >
          <Circle size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.drawArc')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'spline' ? 'active' : ''}`}
          onClick={() => handleDrawMode('spline')}
          title={t('toolbar.splineEditTitle')}
          aria-label={t('toolbar.splineEdit')}
          aria-pressed={editMode === 'spline'}
        >
          <Spline size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.splineEdit')}</span>
        </button>
        <button
          className={`toolbar-btn toolbar-toggle ${editMode === 'spiral' ? 'active' : ''}`}
          onClick={() => handleDrawMode('spiral')}
          title={t('toolbar.drawSpiralTitle')}
        >
          <Waves size={16} className="tb-icon" />
          <span className="tb-label">{t('toolbar.drawSpiral')}</span>
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
                <span className="tb-icon tb-plugin-icon">{btn.icon}</span>
              </button>
            ))}
          </div>
        </>
      )}

    </div>
  );
}

