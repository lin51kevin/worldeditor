import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { getPlatformService } from '../../services';
import type { Road, RoadSignal, RoadObjectItem } from '../../services/platform';
import { COMMON_SIGNAL_TYPES } from '../../hooks/useSignalPlacement';
import { RoadMarkingPanel } from './RoadMarkingPanel';
import { LaneEditor } from './LaneEditor';
import { SuperelevationEditor } from './SuperelevationEditor';
import { CrossfallEditor } from './CrossfallEditor';
import { JunctionEditor } from './JunctionEditor';
import './PropertyPanel.css';

/** Valid bridge structure types (mirrors OpenDRIVE spec values). */
const BRIDGE_TYPES = ['concrete', 'steel', 'wood', 'other'] as const;
/** Valid tunnel structure types (mirrors OpenDRIVE spec values). */
const TUNNEL_TYPES = ['underpass', 'standard', 'other'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRoadLateralRange(road: Road): number {
  let maxWidth = 8;
  for (const section of road.lane_sections) {
    const leftWidth = section.left.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    const rightWidth = section.right.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    maxWidth = Math.max(maxWidth, leftWidth, rightWidth);
  }
  return Math.max(8, Math.ceil(maxWidth + 4));
}

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

  // Local draft state for bridge/tunnel numeric inputs.
  // Committed to the store (and undo stack) only on blur — one snapshot per edit.
  const [bridgeDraft, setBridgeDraft] = useState<Array<{ s: string; length: string }>>([]);
  const [tunnelDraft, setTunnelDraft] = useState<Array<{ s: string; length: string }>>([]);

  // Local draft state for name inputs — committed on blur/Enter for single undo entry.
  const [roadNameDraft, setRoadNameDraft] = useState('');

  useEffect(() => {
    setRoadNameDraft(selectedRoad?.name || '');
  }, [selectedRoad?.id, selectedRoad?.name]);

  useEffect(() => {
    setBridgeDraft((selectedRoad?.bridges ?? []).map((b) => ({
      s: String(b.s),
      length: String(b.length),
    })));
    setTunnelDraft((selectedRoad?.tunnels ?? []).map((t) => ({
      s: String(t.s),
      length: String(t.length),
    })));
  }, [selectedRoad]);

  // Resolve selected signal when a signal node is selected
  const selectedSignal: RoadSignal | null = (() => {
    if (selectedSceneNode?.type !== 'signal') return null;
    const road = project.roads.find((r) => r.id === selectedSceneNode.roadId);
    return (road?.signals ?? []).find((s) => s.id === selectedSceneNode.signalId) ?? null;
  })();
  const selectedSignalRoad: Road | null = (() => {
    if (selectedSceneNode?.type !== 'signal') return null;
    return project.roads.find((r) => r.id === selectedSceneNode.roadId) ?? null;
  })();

  // Resolve selected object when an object node is selected
  const selectedObject: RoadObjectItem | null = (() => {
    if (selectedSceneNode?.type !== 'object') return null;
    const road = project.roads.find((r) => r.id === selectedSceneNode.roadId);
    return (road?.objects ?? []).find((o) => o.id === selectedSceneNode.objectId) ?? null;
  })();

  const isEditingGeometry = geometryEditRoadId === selectedRoadId;
  const signalTypeOptions = (() => {
    const currentType = selectedSignal?.signal_type;
    const options = COMMON_SIGNAL_TYPES.map((option) => ({
      value: option.type,
      label: t(option.labelKey, option.type),
    }));
    if (currentType && !options.some((option) => option.value === currentType)) {
      options.unshift({ value: currentType, label: currentType });
    }
    return options;
  })();
  const signalRoadLength = selectedSignalRoad?.length ?? 0;
  const signalTRange = selectedSignalRoad ? getRoadLateralRange(selectedSignalRoad) : 8;
  const superelevationProfile = selectedRoad?.lateral_profile?.superelevation
    ?? selectedRoad?.lateral_profile?.superelevations
    ?? [];
  const crossfallProfile = selectedRoad?.lateral_profile?.crossfall
    ?? selectedRoad?.lateral_profile?.crossfalls
    ?? [];

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
                    value={roadNameDraft}
                    placeholder="—"
                    onChange={(e) => setRoadNameDraft(e.target.value)}
                    onBlur={() => {
                      if (roadNameDraft !== (selectedRoad.name || '')) {
                        useProjectStore.getState().updateRoad(selectedRoad.id, { name: roadNameDraft });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
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
                <LaneEditor
                  roadId={selectedRoad.id}
                  laneSections={selectedRoad.lane_sections}
                  roadLength={selectedRoad.length}
                />
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

              <CardSection title={`${t('propertyPanel.superelevation')} (${superelevationProfile.length})`} defaultOpen={false}>
                <SuperelevationEditor
                  roadId={selectedRoad.id}
                  profile={superelevationProfile}
                />
              </CardSection>

              <CardSection title={`${t('propertyPanel.crossfall')} (${crossfallProfile.length})`} defaultOpen={false}>
                <CrossfallEditor
                  roadId={selectedRoad.id}
                  profile={crossfallProfile}
                />
              </CardSection>

              {/* Bridges Card */}
              {((selectedRoad.bridges?.length ?? 0) > 0) && (
                <CardSection title={`${t('propertyPanel.bridges', 'Bridges')} (${selectedRoad.bridges!.length})`} defaultOpen>
                  {selectedRoad.bridges!.map((bridge, bi) => (
                    <div key={bridge.id} className="property-lane-section">
                      <div className="property-row sub">
                        <span className="property-label">{bridge.id}</span>
                        <button
                          className="property-btn property-btn-delete-lane"
                          title={t('propertyPanel.deleteBridge', 'Delete Bridge')}
                          onClick={() =>
                            useProjectStore.getState().executePluginCommand(
                              t('propertyPanel.deleteBridge', 'Delete Bridge'),
                              (p) => ({
                                ...p,
                                roads: p.roads.map((r) =>
                                  r.id !== selectedRoad.id
                                    ? r
                                    : { ...r, bridges: (r.bridges ?? []).filter((_, i) => i !== bi) },
                                ),
                              }),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                      <div className="property-row sub lane-row">
                        <span className="property-label">s (m)</span>
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.1"
                          min="0"
                          value={bridgeDraft[bi]?.s ?? String(bridge.s)}
                          onChange={(e) =>
                            setBridgeDraft((prev) =>
                              prev.map((item, i) => i !== bi ? item : { ...item, s: e.target.value }),
                            )
                          }
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              useProjectStore.getState().executePluginCommand(
                                t('propertyPanel.updateBridge', 'Update Bridge'),
                                (p) => ({
                                  ...p,
                                  roads: p.roads.map((r) =>
                                    r.id !== selectedRoad.id ? r : {
                                      ...r,
                                      bridges: (r.bridges ?? []).map((b, i) =>
                                        i !== bi ? b : { ...b, s: val },
                                      ),
                                    },
                                  ),
                                }),
                              );
                            }
                          }}
                        />
                        <span className="property-label">len (m)</span>
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={bridgeDraft[bi]?.length ?? String(bridge.length)}
                          onChange={(e) =>
                            setBridgeDraft((prev) =>
                              prev.map((item, i) => i !== bi ? item : { ...item, length: e.target.value }),
                            )
                          }
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val > 0) {
                              useProjectStore.getState().executePluginCommand(
                                t('propertyPanel.updateBridge', 'Update Bridge'),
                                (p) => ({
                                  ...p,
                                  roads: p.roads.map((r) =>
                                    r.id !== selectedRoad.id ? r : {
                                      ...r,
                                      bridges: (r.bridges ?? []).map((b, i) =>
                                        i !== bi ? b : { ...b, length: val },
                                      ),
                                    },
                                  ),
                                }),
                              );
                            }
                          }}
                        />
                      </div>
                      <div className="property-row sub lane-row">
                        <span className="property-label">{t('propertyPanel.type', 'Type')}</span>
                        <select
                          className="property-select property-select-lane"
                          value={bridge.bridge_type}
                          onChange={(e) =>
                            useProjectStore.getState().executePluginCommand(
                              t('propertyPanel.updateBridge', 'Update Bridge'),
                              (p) => ({
                                ...p,
                                roads: p.roads.map((r) =>
                                  r.id !== selectedRoad.id ? r : {
                                    ...r,
                                    bridges: (r.bridges ?? []).map((b, i) =>
                                      i !== bi ? b : { ...b, bridge_type: e.target.value },
                                    ),
                                  },
                                ),
                              }),
                            )
                          }
                        >
                          {BRIDGE_TYPES.map((bt) => (
                            <option key={bt} value={bt}>{bt}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </CardSection>
              )}

              {/* Tunnels Card */}
              {((selectedRoad.tunnels?.length ?? 0) > 0) && (
                <CardSection title={`${t('propertyPanel.tunnels', 'Tunnels')} (${selectedRoad.tunnels!.length})`} defaultOpen>
                  {selectedRoad.tunnels!.map((tunnel, ti) => (
                    <div key={tunnel.id} className="property-lane-section">
                      <div className="property-row sub">
                        <span className="property-label">{tunnel.id}</span>
                        <button
                          className="property-btn property-btn-delete-lane"
                          title={t('propertyPanel.deleteTunnel', 'Delete Tunnel')}
                          onClick={() =>
                            useProjectStore.getState().executePluginCommand(
                              t('propertyPanel.deleteTunnel', 'Delete Tunnel'),
                              (p) => ({
                                ...p,
                                roads: p.roads.map((r) =>
                                  r.id !== selectedRoad.id
                                    ? r
                                    : { ...r, tunnels: (r.tunnels ?? []).filter((_, i) => i !== ti) },
                                ),
                              }),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                      <div className="property-row sub lane-row">
                        <span className="property-label">s (m)</span>
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.1"
                          min="0"
                          value={tunnelDraft[ti]?.s ?? String(tunnel.s)}
                          onChange={(e) =>
                            setTunnelDraft((prev) =>
                              prev.map((item, i) => i !== ti ? item : { ...item, s: e.target.value }),
                            )
                          }
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              useProjectStore.getState().executePluginCommand(
                                t('propertyPanel.updateTunnel', 'Update Tunnel'),
                                (p) => ({
                                  ...p,
                                  roads: p.roads.map((r) =>
                                    r.id !== selectedRoad.id ? r : {
                                      ...r,
                                      tunnels: (r.tunnels ?? []).map((tn, i) =>
                                        i !== ti ? tn : { ...tn, s: val },
                                      ),
                                    },
                                  ),
                                }),
                              );
                            }
                          }}
                        />
                        <span className="property-label">len (m)</span>
                        <input
                          className="property-input property-input-narrow"
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={tunnelDraft[ti]?.length ?? String(tunnel.length)}
                          onChange={(e) =>
                            setTunnelDraft((prev) =>
                              prev.map((item, i) => i !== ti ? item : { ...item, length: e.target.value }),
                            )
                          }
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val > 0) {
                              useProjectStore.getState().executePluginCommand(
                                t('propertyPanel.updateTunnel', 'Update Tunnel'),
                                (p) => ({
                                  ...p,
                                  roads: p.roads.map((r) =>
                                    r.id !== selectedRoad.id ? r : {
                                      ...r,
                                      tunnels: (r.tunnels ?? []).map((tn, i) =>
                                        i !== ti ? tn : { ...tn, length: val },
                                      ),
                                    },
                                  ),
                                }),
                              );
                            }
                          }}
                        />
                      </div>
                      <div className="property-row sub lane-row">
                        <span className="property-label">{t('propertyPanel.type', 'Type')}</span>
                        <select
                          className="property-select property-select-lane"
                          value={tunnel.tunnel_type}
                          onChange={(e) =>
                            useProjectStore.getState().executePluginCommand(
                              t('propertyPanel.updateTunnel', 'Update Tunnel'),
                              (p) => ({
                                ...p,
                                roads: p.roads.map((r) =>
                                  r.id !== selectedRoad.id ? r : {
                                    ...r,
                                    tunnels: (r.tunnels ?? []).map((tn, i) =>
                                      i !== ti ? tn : { ...tn, tunnel_type: e.target.value },
                                    ),
                                  },
                                ),
                              }),
                            )
                          }
                        >
                          {TUNNEL_TYPES.map((tt) => (
                            <option key={tt} value={tt}>{tt}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </CardSection>
              )}

              {/* Road Markings Card — visible when a lane is selected */}
              {selectedSceneNode?.type === 'lane' && (
                <CardSection title={t('roadMarkings.title')} defaultOpen>
                  <RoadMarkingPanel />
                </CardSection>
              )}
            </div>
            )
          ) : displayMode === 'signal' ? (
            !selectedSignal || !selectedSignalRoad ? null : (
            <div className="inspector-cards">
              <CardSection title={t('propertyPanel.signalProperties', 'Signal Properties')}>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.id')}</span>
                  <span className="property-value">{selectedSignal.id}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">RoadId</span>
                  <span className="property-value">{selectedSignalRoad.id}</span>
                </div>
                <div className="property-row property-row--stacked">
                  <span className="property-label">{t('propertyPanel.station')}</span>
                  <div className="property-control-stack">
                    <input
                      type="range"
                      className="property-range"
                      min={0}
                      max={Math.max(signalRoadLength, 0.1)}
                      step={0.1}
                      value={clamp(selectedSignal.s, 0, Math.max(signalRoadLength, 0.1))}
                      onChange={(event) => useProjectStore.getState().updateSignal(selectedSignal.id, {
                        s: clamp(Number(event.target.value), 0, selectedSignalRoad.length),
                      })}
                    />
                    <span className="property-range-value">{selectedSignal.s.toFixed(2)} m</span>
                  </div>
                </div>
                <div className="property-row property-row--stacked">
                  <span className="property-label">{t('propertyPanel.lateralOffset')}</span>
                  <div className="property-control-stack">
                    <input
                      type="range"
                      className="property-range"
                      min={-signalTRange}
                      max={signalTRange}
                      step={0.1}
                      value={clamp(selectedSignal.t, -signalTRange, signalTRange)}
                      onChange={(event) => useProjectStore.getState().updateSignal(selectedSignal.id, {
                        t: Number(event.target.value),
                      })}
                    />
                    <span className="property-range-value">{selectedSignal.t.toFixed(2)} m</span>
                  </div>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.signalType')}</span>
                  <select
                    className="property-select"
                    value={selectedSignal.signal_type}
                    onChange={(event) => useProjectStore.getState().updateSignal(selectedSignal.id, {
                      signal_type: event.target.value,
                      is_dynamic: event.target.value === 'traffic_light',
                    })}
                  >
                    {signalTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.signalValue')}</span>
                  <input
                    className="property-input"
                    value={selectedSignal.value ?? ''}
                    onChange={(event) => useProjectStore.getState().updateSignal(selectedSignal.id, {
                      value: event.target.value.trim() === '' ? null : event.target.value,
                    })}
                  />
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.signalOrientation')}</span>
                  <select
                    className="property-select"
                    value={selectedSignal.orientation}
                    onChange={(event) => useProjectStore.getState().updateSignal(selectedSignal.id, {
                      orientation: event.target.value,
                    })}
                  >
                    <option value="+">+</option>
                    <option value="-">-</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.headingOffset', 'HeadingLocal')}</span>
                  <span className="property-value">{selectedSignal.h_offset.toFixed(5)}</span>
                </div>
                <div className="property-row">
                  <span className="property-label">{t('propertyPanel.positionLocal', 'PositionLocal')}</span>
                  <span className="property-value">
                    {selectedSignal.s.toFixed(5)}&nbsp;&nbsp;{selectedSignal.t.toFixed(5)}&nbsp;&nbsp;{selectedSignal.z_offset.toFixed(5)}
                  </span>
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
            <JunctionEditor junction={selectedJunction} />
            )
          ) : (
            <div className="property-empty">{t('propertyPanel.noSelection')}</div>
          )}
        </div>
    </div>
  );
}
