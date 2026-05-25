import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import { getPlatformService } from '../../services';
import type { Road, RoadSignal, RoadObjectItem } from '../../services/platform';
import { RoadMarkingPanel } from './RoadMarkingPanel';
import { LaneEditor } from './LaneEditor';
import { SuperelevationEditor } from './SuperelevationEditor';
import { CrossfallEditor } from './CrossfallEditor';
import { JunctionEditor } from './JunctionEditor';
import { InfrastructureEditor } from './property/InfrastructureEditor';
import { SignalPropertiesCard } from './property/SignalPropertiesCard';
import { ObjectPropertiesCard } from './property/ObjectPropertiesCard';
import './PropertyPanel.css';

/** Valid bridge structure types (mirrors OpenDRIVE spec values). */
const BRIDGE_TYPES = ['concrete', 'steel', 'wood', 'other'] as const;
/** Valid tunnel structure types (mirrors OpenDRIVE spec values). */
const TUNNEL_TYPES = ['underpass', 'standard', 'other'] as const;

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

  // Local draft state for name inputs — committed on blur/Enter for single undo entry.
  const [roadNameDraft, setRoadNameDraft] = useState('');

  useEffect(() => {
    setRoadNameDraft(selectedRoad?.name || '');
  }, [selectedRoad?.id, selectedRoad?.name]);

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
                  <InfrastructureEditor
                    type="bridge"
                    items={selectedRoad.bridges!}
                    roadId={selectedRoad.id}
                    typeOptions={BRIDGE_TYPES}
                  />
                </CardSection>
              )}

              {/* Tunnels Card */}
              {((selectedRoad.tunnels?.length ?? 0) > 0) && (
                <CardSection title={`${t('propertyPanel.tunnels', 'Tunnels')} (${selectedRoad.tunnels!.length})`} defaultOpen>
                  <InfrastructureEditor
                    type="tunnel"
                    items={selectedRoad.tunnels!}
                    roadId={selectedRoad.id}
                    typeOptions={TUNNEL_TYPES}
                  />
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
                <SignalPropertiesCard signal={selectedSignal} road={selectedSignalRoad} />
              </CardSection>
            </div>
            )
          ) : displayMode === 'object' ? (
            !selectedObject ? null : (
            <div className="inspector-cards">
              <CardSection title={t('propertyPanel.objectProperties', 'Object Properties')}>
                <ObjectPropertiesCard
                  object={selectedObject}
                  roadId={selectedSceneNode?.type === 'object' ? selectedSceneNode.roadId : '—'}
                />
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
