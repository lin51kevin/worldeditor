import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { getPlatformService } from '../services';
import { RoadEditToolbar } from './RoadEditToolbar';
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
  const { project, selectedRoadId, selectedJunctionId } = useEditorStore();
  const selectedRoad = project.roads.find((r) => r.id === selectedRoadId);
  const selectedJunction = project.junctions.find((j) => j.id === selectedJunctionId);
  const geometryEditRoadId = useEditorViewStore((s) => s.geometryEditRoadId);
  const { t } = useTranslation();
  const [newElevationS, setNewElevationS] = useState(0);
  const [newElevationH, setNewElevationH] = useState(0);

  const isEditingGeometry = geometryEditRoadId === selectedRoadId;

  const handleEditGeometry = async () => {
    if (!selectedRoad || selectedRoad.plan_view.length === 0) return;
    if (isEditingGeometry) {
      // Exit geometry edit mode: finalize
      const viewState = useEditorViewStore.getState();
      const { geometryEditSpline: spline } = viewState;
      if (spline) {
        try {
          const service = await getPlatformService();
          const geometries = await service.splineToGeometries(spline);
          const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
          useEditorStore.getState().updateRoadGeometry(selectedRoad.id, geometries, totalLength);
        } catch (err) {
          console.error('[PropertyPanel] Failed to finalize geometry edit:', err);
        }
      }
      viewState.exitGeometryEdit();
    } else {
      // Enter geometry edit mode
      try {
        const service = await getPlatformService();
        const spline = await service.roadToSpline(selectedRoad, 2.0);
        useEditorViewStore.getState().enterGeometryEdit(selectedRoad.id, spline);
      } catch (err) {
        console.error('[PropertyPanel] Failed to enter geometry edit:', err);
      }
    }
  };

  return (
    <div className="property-panel">
      {/* Drag handle + header */}
      <div className="prop-header">
        <span className="prop-header-title">{t('propertyPanel.properties')}</span>
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
                <button
                  className="geometry-edit-btn"
                  onClick={() => void handleEditGeometry()}
                >
                  {isEditingGeometry ? t('propertyPanel.finishEditGeometry') : t('propertyPanel.editGeometry')}
                </button>
              </CardSection>

              {/* Lanes Card */}
              <CardSection title={`${t('propertyPanel.lanes')} (${selectedRoad.lane_sections.length})`}>
                {selectedRoad.lane_sections.map((ls, si) => (
                  <div key={si} className="property-lane-section">
                    <div className="property-row sub">
                      <span className="property-label">Section #{si + 1} (s={ls.s})</span>
                    </div>
                    {(['left', 'right'] as const).map((side) =>
                      ls[side].map((lane) => {
                        const laneWidth = lane.width[0]?.a ?? 3.5;
                        return (
                          <div key={`${side}-${lane.id}`} className="property-row sub lane-row">
                            <span className="property-label">
                              {side === 'left' ? 'L' : 'R'}{Math.abs(lane.id)}
                            </span>
                            <div className="property-lane-controls">
                              <select
                                className="property-select property-select-lane"
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
                                className="property-input property-input-narrow property-input-lane-width"
                                type="number"
                                step="0.01"
                                min="0.5"
                                max="20"
                                value={laneWidth.toFixed(2)}
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
                          </div>
                        );
                      }),
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
                <div className="property-row">
                  <span className="property-label">s</span>
                  <input
                    className="property-input property-input-narrow"
                    type="number"
                    step="0.1"
                    value={newElevationS}
                    onChange={(e) => setNewElevationS(parseFloat(e.target.value) || 0)}
                  />
                  <span className="property-label">h</span>
                  <input
                    className="property-input property-input-narrow"
                    type="number"
                    step="0.1"
                    value={newElevationH}
                    onChange={(e) => setNewElevationH(parseFloat(e.target.value) || 0)}
                  />
                  <button
                    className="property-btn"
                    onClick={() => useEditorStore.getState().addElevationPoint(selectedRoad.id, newElevationS, newElevationH)}
                  >
                    {t('propertyPanel.addPoint')}
                  </button>
                </div>

                {selectedRoad.elevation_profile
                  .map((elev, sourceIndex) => ({ elev, sourceIndex }))
                  .sort((a, b) => a.elev.s - b.elev.s)
                  .map(({ elev, sourceIndex }, displayIndex) => (
                    <div key={`${sourceIndex}-${elev.s}`} className="property-row sub lane-row">
                      <span className="property-label">#{displayIndex + 1}</span>
                      <div className="property-lane-controls">
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.1"
                          value={elev.s}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!Number.isNaN(value)) {
                              useEditorStore.getState().updateElevationPoint(selectedRoad.id, sourceIndex, { s: value });
                            }
                          }}
                        />
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.01"
                          value={elev.a}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!Number.isNaN(value)) {
                              useEditorStore.getState().updateElevationPoint(selectedRoad.id, sourceIndex, { a: value });
                            }
                          }}
                        />
                        <button
                          className="property-btn"
                          onClick={() => useEditorStore.getState().removeElevationPoint(selectedRoad.id, sourceIndex)}
                        >
                          {t('propertyPanel.deletePoint')}
                        </button>
                      </div>
                    </div>
                  ))}

                <div className="property-row">
                  <button
                    className="property-btn"
                    onClick={() => useEditorStore.getState().smoothElevation(selectedRoad.id, 1)}
                  >
                    {t('propertyPanel.smoothElevation')}
                  </button>
                </div>
              </CardSection>
              {/* Road Edit Tools Card */}
              <RoadEditToolbar />
            </div>
          ) : selectedJunction ? (
            <div className="inspector-cards">
              {/* Junction Properties Card */}
              <CardSection title={t('propertyPanel.junctionProperties')}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.id')}</span>
                  <span className="property-value">{selectedJunction.id}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.name')}</span>
                  <input
                    className="property-input"
                    value={selectedJunction.name || ''}
                    placeholder="—"
                    onChange={(e) => useEditorStore.getState().updateJunction(selectedJunction.id, { name: e.target.value })}
                  />
                </div>
              </CardSection>

              {/* Connections Card */}
              <CardSection title={`${t('propertyPanel.connections')} (${selectedJunction.connections.length})`}>
                {selectedJunction.connections.map((conn) => (
                  <div key={conn.id} className="property-junction-connection">
                    <div className="property-row sub">
                      <span className="property-label">{t('propertyPanel.connectionId')}</span>
                      <span className="property-value">{conn.id}</span>
                    </div>
                    <div className="property-row sub">
                      <span className="property-label">{t('propertyPanel.incomingRoad')}</span>
                      <span className="property-value">{conn.incoming_road}</span>
                    </div>
                    <div className="property-row sub">
                      <span className="property-label">{t('propertyPanel.connectingRoad')}</span>
                      <span className="property-value">{conn.connecting_road}</span>
                    </div>
                    <div className="property-row sub">
                      <span className="property-label">{t('propertyPanel.contactPoint')}</span>
                      <span className="property-value">{conn.contact_point}</span>
                    </div>
                    {conn.lane_links.length > 0 && (
                      <div className="property-row sub">
                        <span className="property-label">{t('propertyPanel.laneLinks')}</span>
                        <span className="property-value">
                          {conn.lane_links.map((ll) => `${ll.from}→${ll.to}`).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {selectedJunction.connections.length === 0 && (
                  <div className="property-row sub">
                    <span className="property-label">—</span>
                  </div>
                )}
              </CardSection>
            </div>
          ) : (
            <div className="property-empty">{t('propertyPanel.noSelection')}</div>
          )}
        </div>
    </div>
  );
}
