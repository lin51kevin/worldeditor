import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Superelevation } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';

interface SuperelevationEditorProps {
  roadId: string;
  profile: Superelevation[];
}

const EMPTY_SUPERELEVATION: Superelevation = { s: 0, a: 0, b: 0, c: 0, d: 0 };

export function SuperelevationEditor({ roadId, profile }: SuperelevationEditorProps) {
  const { t } = useTranslation();
  const [newRecord, setNewRecord] = useState<Superelevation>(EMPTY_SUPERELEVATION);

  const sortedProfile = useMemo(
    () => profile
      .map((record, sourceIndex) => ({ record, sourceIndex }))
      .sort((a, b) => a.record.s - b.record.s),
    [profile],
  );

  const handleNewRecordChange = (field: keyof Superelevation, value: string) => {
    const parsed = parseFloat(value);
    setNewRecord((prev) => ({
      ...prev,
      [field]: Number.isNaN(parsed) ? 0 : parsed,
    }));
  };

  const handleRecordChange = (sourceIndex: number, field: keyof Superelevation, value: string) => {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) {
      useProjectStore.getState().updateSuperelevation(roadId, sourceIndex, { [field]: parsed });
    }
  };

  return (
    <>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.superelevationSegments')}</span>
        <span className="property-value">{profile.length}</span>
      </div>
      <div className="property-row sub lane-row">
        <span className="property-label">+</span>
        <div className="property-lane-controls">
          {(['s', 'a', 'b', 'c', 'd'] as const).map((field) => (
            <div key={field} title={t(`propertyPanel.superelevation${field.toUpperCase()}`)}>
              <span className="property-label">{field}</span>
              <input
                aria-label={t(`propertyPanel.superelevation${field.toUpperCase()}`)}
                className="property-input property-input-narrow"
                type="number"
                step="0.01"
                value={newRecord[field]}
                onChange={(e) => handleNewRecordChange(field, e.target.value)}
              />
            </div>
          ))}
          <button
            className="property-btn"
            onClick={() => {
              useProjectStore.getState().addSuperelevation(roadId, newRecord);
              setNewRecord(EMPTY_SUPERELEVATION);
            }}
          >
            {t('propertyPanel.addPoint')}
          </button>
        </div>
      </div>

      {sortedProfile.map(({ record, sourceIndex }, displayIndex) => (
        <div key={`${sourceIndex}-${record.s}`} className="property-row sub lane-row">
          <span className="property-label">#{displayIndex + 1}</span>
          <div className="property-lane-controls">
            {(['s', 'a', 'b', 'c', 'd'] as const).map((field) => (
              <div key={field} title={t(`propertyPanel.superelevation${field.toUpperCase()}`)}>
                <span className="property-label">{field}</span>
                <input
                  aria-label={`${t(`propertyPanel.superelevation${field.toUpperCase()}`)} ${displayIndex + 1}`}
                  className="property-input property-input-narrow"
                  type="number"
                  step="0.01"
                  value={record[field]}
                  onChange={(e) => handleRecordChange(sourceIndex, field, e.target.value)}
                />
              </div>
            ))}
            <button
              className="property-btn"
              onClick={() => useProjectStore.getState().removeSuperelevation(roadId, sourceIndex)}
            >
              {t('propertyPanel.deletePoint')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
