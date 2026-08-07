import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../../stores/projectStore';
import type { Road, RoadObjectItem } from '../../../services/platform';
import { hasCornerFootprint, moveRoadObjectTo, rotateRoadObjectTo } from '../../../utils/roadObjectTransform';
import {
  NumberField,
  ReadOnlyField,
  SliderField,
  TextField,
  clamp,
  roadLateralRange,
} from './PropertyFields';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

interface ObjectPropertiesCardProps {
  object: RoadObjectItem;
  road: Road | null;
  roadId: string;
}

/** Write a transformed copy of the object back to the store. */
function applyTransform(object: RoadObjectItem, next: RoadObjectItem): void {
  if (next === object) return;
  const { id: _id, ...updates } = next;
  useProjectStore.getState().updateObject(object.id, updates);
}

export const ObjectPropertiesCard = memo(function ObjectPropertiesCard({
  object,
  road,
  roadId,
}: ObjectPropertiesCardProps) {
  const { t } = useTranslation();
  const roadLength = Math.max(road?.length ?? 0, 0.1);
  const tRange = roadLateralRange(road?.lane_sections ?? []);
  // A corner polygon carries its own outline, so length/width only describe the
  // fallback rectangle used when no corners exist.
  const outlineFromCorners = hasCornerFootprint(object);

  const update = (updates: Partial<RoadObjectItem>) =>
    useProjectStore.getState().updateObject(object.id, updates);

  return (
    <>
      <ReadOnlyField label={t('propertyPanel.id')}>{object.id}</ReadOnlyField>
      <ReadOnlyField label="RoadId">{roadId}</ReadOnlyField>
      <ReadOnlyField label="Type">
        {typeof object.object_type === 'string' ? object.object_type : object.object_type.Custom}
      </ReadOnlyField>

      <TextField
        label={t('propertyPanel.name')}
        value={object.name}
        onCommit={(name) => update({ name })}
      />

      <SliderField
        label={t('propertyPanel.station')}
        value={object.position.x}
        min={0}
        max={roadLength}
        onChange={(s) =>
          applyTransform(object, moveRoadObjectTo(object, clamp(s, 0, roadLength), object.position.y))
        }
      />
      <SliderField
        label={t('propertyPanel.lateralOffset')}
        value={object.position.y}
        min={-tRange}
        max={tRange}
        onChange={(lateral) => applyTransform(object, moveRoadObjectTo(object, object.position.x, lateral))}
      />
      <NumberField
        label={t('propertyPanel.zOffset')}
        value={object.position.z}
        onChange={(z) => update({ position: { ...object.position, z } })}
      />
      <SliderField
        label={t('propertyPanel.heading')}
        value={object.hdg * RAD_TO_DEG}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(deg) => applyTransform(object, rotateRoadObjectTo(object, deg * DEG_TO_RAD))}
      />

      <NumberField
        label={t('propertyPanel.length')}
        value={object.length}
        min={0}
        disabled={outlineFromCorners}
        title={outlineFromCorners ? t('propertyPanel.sizeLockedByCorners') : undefined}
        onChange={(length) => update({ length })}
      />
      <NumberField
        label={t('propertyPanel.width')}
        value={object.width}
        min={0}
        disabled={outlineFromCorners}
        title={outlineFromCorners ? t('propertyPanel.sizeLockedByCorners') : undefined}
        onChange={(width) => update({ width })}
      />
      <NumberField
        label={t('propertyPanel.height')}
        value={object.height}
        min={0}
        onChange={(height) => update({ height })}
      />

      {outlineFromCorners && (
        <div className="property-row">
          <span className="property-hint">
            {t('propertyPanel.sizeLockedByCorners')} ({object.corners.length})
          </span>
        </div>
      )}
      <div className="property-row">
        <span className="property-hint">{t('propertyPanel.transformHint')}</span>
      </div>
      <div className="property-row">
        <button
          className="property-btn property-btn-danger"
          onClick={() => useProjectStore.getState().removeObject(object.id)}
        >
          {t('propertyPanel.deleteObject')}
        </button>
      </div>
    </>
  );
});
