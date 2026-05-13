import { Crosshair, Eye, EyeOff, GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Junction } from '../../../services/platform';

export interface JunctionLayerItemProps {
  junction: Junction;
  isSelected: boolean;
  isVisible: boolean;
  entryRef?: (element: HTMLDivElement | null) => void;
  onSelect: () => void;
  onZoom: () => void;
  onToggleVisibility: () => void;
}

export function JunctionLayerItem({
  junction,
  isSelected,
  isVisible,
  entryRef,
  onSelect,
  onZoom,
  onToggleVisibility,
}: JunctionLayerItemProps) {
  const { t } = useTranslation();

  return (
    <div className="road-list-entry" ref={entryRef}>
      <div
        className={`layer-item ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={onSelect}
      >
        <span className="road-expand road-expand-placeholder" />
        <GitMerge size={12} className="junction-icon" />
        <span className="layer-name">
          {junction.name || `Junction(${junction.id})`}
          <span className="road-id"> ({junction.id})</span>
        </span>
        <button
          className="road-zoom-btn"
          onClick={(event) => {
            event.stopPropagation();
            onZoom();
          }}
          title={t('layerPanel.zoomTo')}
        >
          <Crosshair size={12} />
        </button>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisibility();
          }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
}
