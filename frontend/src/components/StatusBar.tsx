import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import './StatusBar.css';

function formatDist(m: number): string {
  if (m >= 1000) return `${m / 1000}km`;
  if (m < 1) return `${Math.round(m * 100)}cm`;
  return `${m}m`;
}

export function StatusBar() {
  const { cursorWorldPos, gridSpacing, viewportMpp } = useEditorStore();
  const { t } = useTranslation();

  // Bar represents 1 grid cell width on screen at current zoom
  const barPx = Math.min(180, Math.max(20, Math.round(gridSpacing / viewportMpp)));

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <MapPin size={11} />
        {t('statusBar.worldCoord')}: {cursorWorldPos.x.toFixed(3)}, {cursorWorldPos.y.toFixed(3)}
      </span>
      <span className="statusbar-item statusbar-scale">
        <span className="scale-bar-track" style={{ width: `${barPx}px` }} />
        <span className="scale-bar-label">{formatDist(gridSpacing)}</span>
      </span>
    </div>
  );
}
