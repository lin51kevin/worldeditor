import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import './PropertyPanel.css';

interface CardSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CardSection({ title, defaultOpen = true, children }: CardSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="inspector-card">
      <div
        className={`inspector-card-header ${!open ? 'collapsed' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </div>
      {open && <div className="inspector-card-body">{children}</div>}
    </div>
  );
}

export function PropertyPanel() {
  const { project, selectedRoadId } = useEditorStore();
  const selectedRoad = project.roads.find((r) => r.id === selectedRoadId);
  const { t } = useTranslation();

  return (
    <div className="property-panel">
      {/* Header */}
      <div className="prop-tabs">
        <button className="prop-tab active">
          {t('propertyPanel.properties')}
        </button>
      </div>

      {/* Properties content */}
      <div className="property-content">
          {selectedRoad ? (
            <div className="inspector-cards">
              {/* Basic Properties Card */}
              <CardSection title={t('propertyPanel.roadProperties')}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.id')}</span>
                  <span className="property-value">{selectedRoad.id}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.name')}</span>
                  <input
                    className="property-input"
                    value={selectedRoad.name || ''}
                    placeholder="—"
                    onChange={(e) => useEditorStore.getState().updateRoad(selectedRoad.id, { name: e.target.value })}
                  />
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.length')}</span>
                  <span className="property-value">{selectedRoad.length.toFixed(2)} m</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.junction')}</span>
                  <span className="property-value">{selectedRoad.junction_id ?? '—'}</span>
                </div>
              </CardSection>

              {/* Geometry Card */}
              <CardSection title={`${t('propertyPanel.geometry')} (${selectedRoad.plan_view.length})`}>
                {selectedRoad.plan_view.map((geo, i) => (
                  <div key={i} className="property-row sub">
                    <span className="property-label">#{i + 1}</span>
                    <span className="property-value">
                      {typeof geo.geo_type === 'string'
                        ? geo.geo_type
                        : Object.keys(geo.geo_type)[0]
                      } ({geo.length.toFixed(1)}m)
                    </span>
                  </div>
                ))}
              </CardSection>

              {/* Lanes Card */}
              <CardSection title={`${t('propertyPanel.lanes')} (${selectedRoad.lane_sections.length})`}>
                {selectedRoad.lane_sections.map((ls, si) => (
                  <div key={si} className="property-lane-section">
                    <div className="property-row sub">
                      <span className="property-label">Section #{si + 1} (s={ls.s})</span>
                    </div>
                    {(['left', 'right'] as const).map((side) =>
                      ls[side].map((lane) => (
                        <div key={`${side}-${lane.id}`} className="property-row sub">
                          <span className="property-label">
                            {side === 'left' ? 'L' : 'R'}{Math.abs(lane.id)}
                          </span>
                          <select
                            className="property-select"
                            value={lane.lane_type}
                            onChange={(e) =>
                              useEditorStore.getState().updateLaneType(
                                selectedRoad.id, si, side, lane.id, e.target.value,
                              )
                            }
                          >
                            <option value="Driving">Driving</option>
                            <option value="Shoulder">Shoulder</option>
                            <option value="Sidewalk">Sidewalk</option>
                            <option value="Parking">Parking</option>
                            <option value="Biking">Biking</option>
                            <option value="Border">Border</option>
                            <option value="Stop">Stop</option>
                            <option value="None">None</option>
                          </select>
                          <input
                            className="property-input property-input-narrow"
                            type="number"
                            step="0.1"
                            min="0.5"
                            max="20"
                            value={lane.width[0]?.a ?? 3.5}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0.5 && val <= 20) {
                                useEditorStore.getState().updateLaneWidth(
                                  selectedRoad.id, si, side, lane.id,
                                  { s_offset: 0, a: val, b: 0, c: 0, d: 0 },
                                );
                              }
                            }}
                          />
                          <span className="property-unit">m</span>
                        </div>
                      )),
                    )}
                  </div>
                ))}
              </CardSection>

              {/* Elevation Card */}
              <CardSection title={`${t('propertyPanel.elevation')} (${selectedRoad.elevation_profile.length})`} defaultOpen={false}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.elevationSegments')}</span>
                  <span className="property-value">{selectedRoad.elevation_profile.length}</span>
                </div>
              </CardSection>
            </div>
          ) : (
            <div className="property-empty">{t('propertyPanel.noSelection')}</div>
          )}
        </div>
    </div>
  );
}
