import { useEffect, useRef, useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { onCursorMove } from '../../viewport/cursorEvents';
import './StatusBar.css';

function formatDist(m: number): string {
  if (m >= 1000) return `${+(m / 1000).toPrecision(3)}km`;
  if (m >= 1) return `${+m.toPrecision(3)}m`;
  if (m >= 0.01) return `${+(m * 100).toPrecision(3)}cm`;
  return `${+(m * 1000).toPrecision(3)}mm`;
}

/** Fixed scale bar pixel width (does not change on zoom). */
const SCALE_BAR_PX = 100;

export function StatusBar() {
  const viewportMpp = useProjectStore((s) => s.viewportMpp);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedLaneSectionIndex = useProjectStore((s) => s.selectedLaneSectionIndex);
  const selectedLaneId = useProjectStore((s) => s.selectedLaneId);
  const { t } = useTranslation();
  const coordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const unsubscribe = onCursorMove((x, y) => {
      if (coordRef.current) {
        coordRef.current.textContent = `${t('statusBar.worldCoord')}: ${x.toFixed(3)}, ${y.toFixed(3)}`;
      }
    });
    return unsubscribe;
  }, [t]);

  const scaleDist = useMemo(() => SCALE_BAR_PX * viewportMpp, [viewportMpp]);

  const selectionLabel = !selectedRoadId
    ? t('statusBar.selectionLevels.none')
    : selectedLaneId !== null
      ? t('statusBar.selectionLevels.lane', { laneId: selectedLaneId })
      : selectedLaneSectionIndex !== null
        ? t('statusBar.selectionLevels.laneSection', { sectionIndex: selectedLaneSectionIndex + 1 })
        : t('statusBar.selectionLevels.road', { roadId: selectedRoadId });

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <MapPin size={11} />
        <span ref={coordRef}>{t('statusBar.worldCoord')}: 0.000, 0.000</span>
      </span>
      <span className="statusbar-item">
        <span>{t('statusBar.selection')}: {selectionLabel}</span>
      </span>
      <span className="statusbar-item statusbar-scale">
        <span className="scale-bar-track" style={{ width: `${SCALE_BAR_PX}px` }} />
        <span className="scale-bar-label">{formatDist(scaleDist)}</span>
      </span>
    </div>
  );
}
