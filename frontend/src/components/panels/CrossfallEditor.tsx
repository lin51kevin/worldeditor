import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Crossfall } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';

interface CrossfallEditorProps {
  roadId: string;
  profile: Crossfall[];
}

type CrossfallField = 's' | 'a' | 'b' | 'c' | 'd';
type CrossfallSide = NonNullable<Crossfall['side']>;

const CROSSFALL_FIELDS: readonly CrossfallField[] = ['s', 'a', 'b', 'c', 'd'];
const CROSSFALL_SIDES: readonly CrossfallSide[] = ['left', 'right', 'both'];
const DEFAULT_CROSSFALL_SIDE: CrossfallSide = 'both';
const EMPTY_CROSSFALL: Crossfall = { s: 0, a: 0, b: 0, c: 0, d: 0, side: DEFAULT_CROSSFALL_SIDE };

export function CrossfallEditor({ roadId, profile }: CrossfallEditorProps) {
  const { t } = useTranslation();
  const [newRecord, setNewRecord] = useState<Crossfall>(EMPTY_CROSSFALL);

  const sortedProfile = useMemo(
    () => profile
      .map((record, sourceIndex) => ({ record, sourceIndex }))
      .sort((a, b) => a.record.s - b.record.s),
    [profile],
  );

  const handleNewRecordChange = (field: CrossfallField, value: string) => {
    const parsed = parseFloat(value);
    setNewRecord((prev) => ({
      ...prev,
      [field]: Number.isNaN(parsed) ? 0 : parsed,
    }));
  };

  const handleRecordChange = (sourceIndex: number, field: CrossfallField, value: string) => {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) {
      useProjectStore.getState().updateCrossfall(roadId, sourceIndex, { [field]: parsed });
    }
  };

  const handleNewSideChange = (value: string) => {
    setNewRecord((prev) => ({
      ...prev,
      side: value as CrossfallSide,
    }));
  };

  const handleRecordSideChange = (sourceIndex: number, value: string) => {
    useProjectStore.getState().updateCrossfall(roadId, sourceIndex, { side: value as CrossfallSide });
  };

  return (
    <>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.crossfallSegments')}</span>
        <span className="property-value">{profile.length}</span>
      </div>
      <div className="property-row sub lane-row">
        <span className="property-label">+</span>
        <div className="property-lane-controls">
          {CROSSFALL_FIELDS.map((field) => (
            <div key={field} title={t(`propertyPanel.crossfall${field.toUpperCase()}`)}>
              <span className="property-label">{field}</span>
              <input
                aria-label={t(`propertyPanel.crossfall${field.toUpperCase()}`)}
                className="property-input property-input-narrow"
                type="number"
                step="0.01"
                value={newRecord[field]}
                onChange={(e) => handleNewRecordChange(field, e.target.value)}
              />
            </div>
          ))}
          <div title={t('propertyPanel.crossfallSide')}>
            <span className="property-label">{t('propertyPanel.crossfallSideShort')}</span>
            <select
              aria-label={t('propertyPanel.crossfallSide')}
              className="property-select property-select-lane"
              value={newRecord.side ?? DEFAULT_CROSSFALL_SIDE}
              onChange={(e) => handleNewSideChange(e.target.value)}
            >
              {CROSSFALL_SIDES.map((side) => (
                <option key={side} value={side}>{t(`propertyPanel.crossfallSide${side[0]!.toUpperCase()}${side.slice(1)}`)}</option>
              ))}
            </select>
          </div>
          <button
            className="property-btn"
            onClick={() => {
              useProjectStore.getState().addCrossfall(roadId, newRecord);
              setNewRecord(EMPTY_CROSSFALL);
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
            {CROSSFALL_FIELDS.map((field) => (
              <div key={field} title={t(`propertyPanel.crossfall${field.toUpperCase()}`)}>
                <span className="property-label">{field}</span>
                <input
                  aria-label={`${t(`propertyPanel.crossfall${field.toUpperCase()}`)} ${displayIndex + 1}`}
                  className="property-input property-input-narrow"
                  type="number"
                  step="0.01"
                  value={record[field]}
                  onChange={(e) => handleRecordChange(sourceIndex, field, e.target.value)}
                />
              </div>
            ))}
            <div title={t('propertyPanel.crossfallSide')}>
              <span className="property-label">{t('propertyPanel.crossfallSideShort')}</span>
              <select
                aria-label={`${t('propertyPanel.crossfallSide')} ${displayIndex + 1}`}
                className="property-select property-select-lane"
                value={record.side ?? DEFAULT_CROSSFALL_SIDE}
                onChange={(e) => handleRecordSideChange(sourceIndex, e.target.value)}
              >
                {CROSSFALL_SIDES.map((side) => (
                  <option key={side} value={side}>{t(`propertyPanel.crossfallSide${side[0]!.toUpperCase()}${side.slice(1)}`)}</option>
                ))}
              </select>
            </div>
            <button
              className="property-btn"
              onClick={() => useProjectStore.getState().removeCrossfall(roadId, sourceIndex)}
            >
              {t('propertyPanel.deletePoint')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
