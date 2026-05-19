import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { getPlatformService } from '../../services';
import type { RoadSignal, RoadObjectItem } from '../../services/platform';
import { RoadMarkingPanel } from './RoadMarkingPanel';
import './PropertyPanel.css';

interface CardSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CardSection = memo(function CardSection({ title, defaultOpen = true, children }: CardSectionProps) {
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
});

export function PropertyPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const selectedRoad = project.roads.find((r) => r.id === selectedRoadId);
  const selectedJunction = project.junctions.find((j) => j.id === selectedJunctionId);
  const geometryEditRoadId = useViewportStore((s) => s.geometryEditRoadId);
  const { t } = useTranslation();
  const [newElevationS, setNewElevationS] = useState(0);
  const [newElevationH, setNewElevationH] = useState(0);

  // Resolve selected signal when a signal node is selected
  const selectedSignal: RoadSignal | null = (() => {
    if (selectedSceneNode?.type !== 'signal') return null;
    const road = project.roads.find((r) => r.id === selectedSceneNode.roadId);
    return (road?.signals ?? []).find((s) => s.id === selectedSceneNode.signalId) ?? null;
  })();

  // Resolve selected object when an object node is selected
  const selectedObject: RoadObjectItem | null = (() => {
    if (selectedSceneNode?.type !== 'object') return null;
    const road = project.roads.find((r) => r.id === selectedSceneNode.roadId);
    return (road?.objects ?? []).find((o) => o.id === selectedSceneNode.objectId) ?? null;
  })();

  const isEditingGeometry = geometryEditRoadId === selectedRoadId;

  // Determine what to display — signal/object take priority even though selectedRoadId is also set
  type DisplayMode = 'road' | 'signal' | 'object' | 'junction' | 'none';
  const displayMode: DisplayMode = (() => {
    if (selectedSceneNode?.type === 'signal') return 'signal';
    if (selectedSceneNode?.type === 'object') return 'object';
    if (selectedRoad) return 'road';
    if (selectedJunction) return 'junction';
    return 'none';
  })();

  const handleEditGeometry = async () => {
    if (!selectedRoad || selectedRoad.plan_view.length === 0) return;
    if (isEditingGeometry) {
      // Exit geometry edit mode: finalize
      const viewState = useViewportStore.getState();
      const { geometryEditSpline: spline } = viewState;
      if (spline) {
        try {
          const service = await getPlatformService();
          const geometries = await service.splineToGeometries(spline);
          const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
          useProjectStore.getState().updateRoadGeometry(selectedRoad.id, geometries, totalLength);
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
        useViewportStore.getState().enterGeometryEdit(selectedRoad.id, spline);
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
          {displayMode === 'road' ? (
            !selectedRoad ? null : (
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
                    onChange={(e) => useProjectStore.getState().updateRoad(selectedRoad.id, { name: e.target.value })}
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
              <CardSection title={`${t('propertyPanel.geometry')} (${selectedRoad.plan_view.length})`} defaultOpen={false}>
                {selectedRoad.plan_view.map((geo, i) => {
                  const typeName = typeof geo.geo_type === 'string'
                    ? geo.geo_type
                    : Object.keys(geo.geo_type)[0];
                  const typeData = typeof geo.geo_type === 'object' ? geo.geo_type : null;

                  // Extract curvature info for Arc and Spiral
                  let curvatureInfo = '';
                  if (typeData && 'Arc' in typeData) {
                    const arc = typeData.Arc as { curvature: number };
                    const radius = Math.abs(1.0 / arc.curvature);
                    const dir = arc.curvature > 0 ? 'L' : 'R';
                    curvatureInfo = ` κ=${arc.curvature.toFixed(4)} R=${radius.toFixed(1)}m ${dir}`;
                  } else if (typeData && 'Spiral' in typeData) {
                    const spiral = typeData.Spiral as { curv_start: number; curv_end: number };
                    curvatureInfo = ` κ₀=${spiral.curv_start.toFixed(4)} κ₁=${spiral.curv_end.toFixed(4)}`;
                  }

                  return (
                    <div key={i} className="property-row sub">
                      <span className="property-label">#{i + 1}</span>
                      <span className="property-value" title={curvatureInfo.trim()}>
                        {typeName} ({geo.length.toFixed(1)}m){curvatureInfo && <span className="property-value-detail">{curvatureInfo}</span>}
                      </span>
                    </div>
                  );
                })}
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
                      <span className="property-label">{t('propertyPanel.laneSection')} #{si + 1} (s={ls.s})</span>
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
                                  useProjectStore.getState().updateLaneType(
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
                                    useProjectStore.getState().updateLaneWidth(
                                      selectedRoad.id, si, side, lane.id,
                                      { s_offset: 0, a: val, b: 0, c: 0, d: 0 },
                                    );
                                  }
                                }}
                              />
                              <span className="property-unit">m</span>
                              <button
                                className="property-btn property-btn-delete-lane"
                                title={t('propertyPanel.deleteLane')}
                                onClick={() =>
                                  useProjectStore.getState().removeLane(selectedRoad.id, si, side, lane.id)
                                }
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      }),
                    )}
                    <div className="property-row sub lane-add-row">
                      <button
                        className="property-btn property-btn-add-lane"
                        title={t('propertyPanel.addLane')}
                        onClick={() => useProjectStore.getState().addLane(selectedRoad.id, si, 'left')}
                      >
                        +L
                      </button>
                      <button
                        className="property-btn property-btn-add-lane"
                        title={t('propertyPanel.addLane')}
                        onClick={() => useProjectStore.getState().addLane(selectedRoad.id, si, 'right')}
                      >
                        +R
                      </button>
                    </div>
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
                    onClick={() => useProjectStore.getState().addElevationPoint(selectedRoad.id, newElevationS, newElevationH)}
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
                              useProjectStore.getState().updateElevationPoint(selectedRoad.id, sourceIndex, { s: value });
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
                              useProjectStore.getState().updateElevationPoint(selectedRoad.id, sourceIndex, { a: value });
                            }
                          }}
                        />
                        <button
                          className="property-btn"
                          onClick={() => useProjectStore.getState().removeElevationPoint(selectedRoad.id, sourceIndex)}
                        >
                          {t('propertyPanel.deletePoint')}
                        </button>
                      </div>
                    </div>
                  ))}

                <div className="property-row">
                  <button
                    className="property-btn"
                    onClick={() => useProjectStore.getState().smoothElevation(selectedRoad.id, 1)}
                  >
                    {t('propertyPanel.smoothElevation')}
                  </button>
                </div>
              </CardSection>
            </div>
            )
          ) : displayMode === 'signal' ? (
            !selectedSignal ? null : (
            <div className="inspector-cards">
              <CardSection title={t('propertyPanel.signalProperties', 'Signal Properties')}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.id')}</span>
                  <span className="property-value">{selectedSignal.id}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.name')}</span>
                  <span className="property-value">{selectedSignal.name || '—'}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">RoadId</span>
                  <span className="property-value">{selectedSceneNode?.type === 'signal' ? selectedSceneNode.roadId : '—'}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Type</span>
                  <span className="property-value">{selectedSignal.signal_type}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">SubType</span>
                  <span className="property-value">{selectedSignal.signal_subtype || '—'}</span>
                </div>
                {selectedSignal.value !== null && (
                  <div className="property-row">
                    <span className="property-label">Value</span>
                    <span className="property-value">{selectedSignal.value}</span>
                  </div>
                )}
                <div className="property-row">
                  <span className="property-label">s (m)</span>
                  <span className="property-value">{selectedSignal.s.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">t (m)</span>
                  <span className="property-value">{selectedSignal.t.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.headingOffset', 'HeadingLocal')}</span>
                  <span className="property-value">
                    {selectedSignal.h_offset.toFixed(5)}&nbsp;&nbsp;{Number(Math.cos(selectedSignal.h_offset)).toFixed(5)}&nbsp;&nbsp;{Number(0).toFixed(5)}
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.positionLocal', 'PositionLocal')}</span>
                  <span className="property-value">
                    {selectedSignal.s.toFixed(5)}&nbsp;&nbsp;{selectedSignal.t.toFixed(5)}&nbsp;&nbsp;{selectedSignal.z_offset.toFixed(5)}
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">Width (m)</span>
                  <span className="property-value">{selectedSignal.width.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Height (m)</span>
                  <span className="property-value">{selectedSignal.height.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.isDynamic', 'IsDynamic')}</span>
                  <span className="property-value">
                    <input type="checkbox" readOnly checked={selectedSignal.is_dynamic} style={{ pointerEvents: 'none' }} />
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">Orientation</span>
                  <span className="property-value">{selectedSignal.orientation}</span>
                </div>
              </CardSection>
            </div>
            )
          ) : displayMode === 'object' ? (
            !selectedObject ? null : (
            <div className="inspector-cards">
              <CardSection title={t('propertyPanel.objectProperties', 'Object Properties')}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.id')}</span>
                  <span className="property-value">{selectedObject.id}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">RoadId</span>
                  <span className="property-value">{selectedSceneNode?.type === 'object' ? selectedSceneNode.roadId : '—'}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Type</span>
                  <span className="property-value">
                    {typeof selectedObject.object_type === 'string'
                      ? selectedObject.object_type
                      : selectedObject.object_type.Custom}
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.name')}</span>
                  <span className="property-value">{selectedObject.name || '—'}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.positionLocal', 'PositionLocal')}</span>
                  <span className="property-value">
                    {selectedObject.position.x.toFixed(5)}&nbsp;&nbsp;{selectedObject.position.y.toFixed(5)}&nbsp;&nbsp;{selectedObject.position.z.toFixed(5)}
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.headingLocal', 'HeadingLocal')}</span>
                  <span className="property-value">
                    {Math.cos(selectedObject.hdg).toFixed(5)}&nbsp;&nbsp;{Math.sin(selectedObject.hdg).toFixed(5)}&nbsp;&nbsp;{Number(0).toFixed(5)}
                  </span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.length', 'Length')}</span>
                  <span className="property-value">{selectedObject.length.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Width</span>
                  <span className="property-value">{selectedObject.width.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">Height</span>
                  <span className="property-value">{selectedObject.height.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.radius', 'Radius')}</span>
                  <span className="property-value">
                    {(() => {
                      if (selectedObject.corners.length === 0) return '—';
                      const cx = selectedObject.position.x;
                      const cy = selectedObject.position.y;
                      const corner = selectedObject.corners[0];
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
              </CardSection>
            </div>
            )
          ) : displayMode === 'junction' ? (
            !selectedJunction ? null : (
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
                    onChange={(e) => useProjectStore.getState().updateJunction(selectedJunction.id, { name: e.target.value })}
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
            )
          ) : (
            <div className="property-empty">{t('propertyPanel.noSelection')}</div>
          )}
          <RoadMarkingPanel />
        </div>
    </div>
  );
}
