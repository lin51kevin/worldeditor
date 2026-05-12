import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { onCursorMove } from '../viewport/cursorEvents';
import './StatusBar.css';

function formatDist(m: number): string {
  if (m >= 1000) return `${m / 1000}km`;
  if (m < 1) return `${Math.round(m * 100)}cm`;
  return `${m}m`;
}

export function StatusBar() {
  // gridSpacing and viewportMpp are stable — only change on camera/scale changes
  const gridSpacing = useEditorStore((s) => s.gridSpacing);
  const viewportMpp = useEditorStore((s) => s.viewportMpp);
  const { t } = useTranslation();
  const coordRef = useRef<HTMLSpanElement>(null);

  // Direct DOM update for cursor coordinates (no React re-render)
  useEffect(() => {
    const unsubscribe = onCursorMove((x, y) => {
      if (coordRef.current) {
        coordRef.current.textContent = `${t('statusBar.worldCoord')}: ${x.toFixed(3)}, ${y.toFixed(3)}`;
      }
    });
    return unsubscribe;
  }, [t]);

  // Bar represents 1 grid cell width on screen at current zoom
  const barPx = Math.min(180, Math.max(20, Math.round(gridSpacing / viewportMpp)));

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <MapPin size={11} />
        <span ref={coordRef}>{t('statusBar.worldCoord')}: 0.000, 0.000</span>
      </span>
      <span className="statusbar-item statusbar-scale">
        <span className="scale-bar-track" style={{ width: `${barPx}px` }} />
        <span className="scale-bar-label">{formatDist(gridSpacing)}</span>
      </span>
    </div>
  );
}
