import { useEffect, useRef, useMemo } from 'react';
import { MapPin, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { onCursorMove } from '../../viewport/cursorEvents';
import { niceNumber } from '../../viewport/viewportMath';
import './StatusBar.css';

function formatDist(m: number): string {
  if (m >= 1000) return `${m / 1000}km`;
  if (m < 1) return `${Math.round(m * 100)}cm`;
  return `${m}m`;
}

/** Target scale bar pixel width used for the calculation baseline. */
const SCALE_TARGET_PX = 100;

export function StatusBar() {
  const viewportMpp = useProjectStore((s) => s.viewportMpp);
  const roadCount = useProjectStore((s) => s.project.roads.length);
  const editMode = useViewportStore((s) => s.editMode);
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

  const { barPx, scaleDist } = useMemo(() => {
    const rawDist = SCALE_TARGET_PX * viewportMpp;
    const niceDist = niceNumber(rawDist);
    const px = Math.round(niceDist / viewportMpp);
    return { barPx: px, scaleDist: niceDist };
  }, [viewportMpp]);

  const modeLabel = t(`statusBar.modes.${editMode}`, editMode);

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <MapPin size={11} />
        <span ref={coordRef}>{t('statusBar.worldCoord')}: 0.000, 0.000</span>
      </span>
      <span className="statusbar-item">
        <Pencil size={11} />
        <span className="statusbar-mode">{t('statusBar.mode')}: {modeLabel}</span>
      </span>
      <span className="statusbar-item">{t('statusBar.roads')}: {roadCount}</span>
      <span className="statusbar-item statusbar-scale">
        <span className="scale-bar-track" style={{ width: `${barPx}px` }} />
        <span className="scale-bar-label">{formatDist(scaleDist)}</span>
      </span>
    </div>
  );
}
