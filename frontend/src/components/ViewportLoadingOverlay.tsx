import { useEffect, useRef } from 'react';
import { useLoadingProgressStore } from '../stores/loadingProgressStore';
import type { LoadingPhase } from '../stores/loadingProgressStore';
import { useTranslation } from 'react-i18next';
import './ViewportLoadingOverlay.css';

function getPhaseLabel(phase: LoadingPhase, t: (key: string) => string): string {
  switch (phase) {
    case 'reading':
      return t('loading.readingFile');
    case 'parsing':
      return t('loading.parsingMap');
    case 'generating-mesh':
      return t('loading.generatingMesh');
    case 'done':
      return t('loading.complete');
    default:
      return '';
  }
}

export function ViewportLoadingOverlay() {
  const { phase, progress, fileName } = useLoadingProgressStore();
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Auto-hide after completion with a short delay
  useEffect(() => {
    if (phase === 'done') {
      const timer = setTimeout(() => {
        useLoadingProgressStore.getState().reset();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  if (phase === 'idle') return null;

  const phaseLabel = getPhaseLabel(phase, t);

  return (
    <div ref={overlayRef} className={`viewport-loading-overlay${phase === 'done' ? ' fade-out' : ''}`}>
      <div className="viewport-loading-content">
        <div className="viewport-loading-spinner" />
        <div className="viewport-loading-info">
          <div className="viewport-loading-filename" title={fileName}>
            {fileName}
          </div>
          <div className="viewport-loading-phase">
            {phaseLabel}
          </div>
          <div className="viewport-loading-bar-container">
            <div
              className="viewport-loading-bar"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="viewport-loading-percent">
            {Math.round(progress)}%
          </div>
        </div>
      </div>
    </div>
  );
}
