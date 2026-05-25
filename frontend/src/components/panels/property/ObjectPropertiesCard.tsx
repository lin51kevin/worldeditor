import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoadObjectItem } from '../../../services/platform';

interface ObjectPropertiesCardProps {
  object: RoadObjectItem;
  roadId: string;
}

export const ObjectPropertiesCard = memo(function ObjectPropertiesCard({ object, roadId }: ObjectPropertiesCardProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.id')}</span>
        <span className="property-value">{object.id}</span>
      </div>
      <div className="property-row">
        <span className="property-label">RoadId</span>
        <span className="property-value">{roadId}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Type</span>
        <span className="property-value">
          {typeof object.object_type === 'string'
            ? object.object_type
            : object.object_type.Custom}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.name')}</span>
        <span className="property-value">{object.name || '—'}</span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.positionLocal', 'PositionLocal')}</span>
        <span className="property-value">
          {object.position.x.toFixed(5)}&nbsp;&nbsp;{object.position.y.toFixed(5)}&nbsp;&nbsp;{object.position.z.toFixed(5)}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.headingLocal', 'HeadingLocal')}</span>
        <span className="property-value">
          {Math.cos(object.hdg).toFixed(5)}&nbsp;&nbsp;{Math.sin(object.hdg).toFixed(5)}&nbsp;&nbsp;{Number(0).toFixed(5)}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.length', 'Length')}</span>
        <span className="property-value">{object.length.toFixed(5)}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Width</span>
        <span className="property-value">{object.width.toFixed(5)}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Height</span>
        <span className="property-value">{object.height.toFixed(5)}</span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.radius', 'Radius')}</span>
        <span className="property-value">
          {(() => {
            if (object.corners.length === 0) return '—';
            const cx = object.position.x;
            const cy = object.position.y;
            const corner = object.corners[0];
            if (!corner) return '—';
            const r = Math.sqrt((corner.x - cx) ** 2 + (corner.y - cy) ** 2);
            return r.toFixed(5);
          })()}
        </span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.isDynamic', 'IsDynamic')}</span>
        <span className="property-value">
          <input type="checkbox" readOnly checked={false} style={{ pointerEvents: 'none' }} />
        </span>
      </div>
    </>
  );
});
