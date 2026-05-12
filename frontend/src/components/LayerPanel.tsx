import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye, EyeOff, ChevronRight, ChevronDown,
  Crosshair, GitMerge, X,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import {
  makeLaneKey,
  makeLaneSectionKey,
  type LaneSide,
} from '../utils/sceneGraph';
import { emitViewportEvent } from '../viewport/viewportEvents';
import './LayerPanel.css';

const DISPLAY_TOGGLES = [
  'showLaneLines',
  'showRoadMarks',
  'showReferenceLine',
  'showSignals',
  'showObjects',
] as const;

/** Check whether the project has any real data loaded (non-empty roads or header name). */
function hasProjectData(project: { roads: unknown[]; junctions: unknown[]; header: { name: string } }): boolean {
  return project.roads.length > 0 || project.junctions.length > 0 || !!project.header.name;
}

export function LayerPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedSceneNode = useEditorStore((s) => s.selectedSceneNode);
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const selectedRoadIds = useEditorStore((s) => s.selectedRoadIds);
  const selectedJunctionIds = useEditorStore((s) => s.selectedJunctionIds);
  const selectRoad = useEditorStore((s) => s.selectRoad);
  const selectJunction = useEditorStore((s) => s.selectJunction);
  const selectLaneSection = useEditorStore((s) => s.selectLaneSection);
  const selectLane = useEditorStore((s) => s.selectLane);
  const {
    display,
    toggleDisplaySetting,
    setColorMode,
    toggleRoadVisibility: toggleRoadVisibilityInStore,
    toggleJunctionVisibility: toggleJunctionVisibilityInStore,
    toggleLaneSectionVisibility: toggleLaneSectionVisibilityInStore,
    toggleLaneVisibility: toggleLaneVisibilityInStore,
  } = useEditorViewStore();
  const [expandedRoads, setExpandedRoads] = useState<Set<string>>(new Set());
  const [expandedLaneSections, setExpandedLaneSections] = useState<Set<string>>(new Set());
  const [mapInfoCollapsed, setMapInfoCollapsed] = useState(true);
  const [displaySettingsCollapsed, setDisplaySettingsCollapsed] = useState(true);
  const [sceneListCollapsed, setSceneListCollapsed] = useState(false);
  const { t } = useTranslation();

  // Refs for auto-scroll: track each row's DOM element
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // Track whether the last selection came from within the panel (to avoid unwanted auto-scroll)
  const selectionSourceRef = useRef<'panel' | 'viewport'>('viewport');

  // Auto-scroll to the selected road/junction when selection originates from the viewport
  useEffect(() => {
    if (selectionSourceRef.current === 'panel') {
      selectionSourceRef.current = 'viewport';
      return;
    }
    const id = selectedRoadId ? `road-${selectedRoadId}` : selectedJunctionId ? `junc-${selectedJunctionId}` : null;
    if (!id) return;
    // Ensure the scene list section is expanded so the item is visible
    setSceneListCollapsed(false);
    const el = rowRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedRoadId, selectedJunctionId]);


  const toggleRoadExpand = (roadId: string) => {
    setExpandedRoads((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  };

  const toggleLaneSectionExpand = (sectionKey: string) => {
    setExpandedLaneSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey);
      return next;
    });
  };

  const toggleRoadVisibility = (roadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleRoadVisibilityInStore(roadId);
  };

  const toggleJunctionVisibility = (junctionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleJunctionVisibilityInStore(junctionId);
  };

  const toggleLaneSectionVisibility = (sectionKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLaneSectionVisibilityInStore(sectionKey);
  };

  const toggleLaneVisibility = (
    roadId: string,
    sectionIndex: number,
    side: LaneSide,
    laneId: number,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    toggleLaneVisibilityInStore(roadId, sectionIndex, side, laneId);
  };

  const isRoadVisible = (roadId: string) => !display.hiddenRoadIds.includes(roadId);
  const isJunctionVisible = (junctionId: string) => !display.hiddenJunctionIds.includes(junctionId);
  const isLaneSectionVisible = (roadId: string, sectionIndex: number) =>
    isRoadVisible(roadId) && !display.hiddenLaneSectionKeys.includes(makeLaneSectionKey(roadId, sectionIndex));
  const isLaneVisible = (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) =>
    isLaneSectionVisible(roadId, sectionIndex) && !display.hiddenLaneKeys.includes(
      makeLaneKey(roadId, sectionIndex, side, laneId),
    );

  const selectRoadChildSection = (roadId: string, sectionIndex: number) => {
    setExpandedRoads((prev) => new Set(prev).add(roadId));
    setExpandedLaneSections((prev) => new Set(prev).add(makeLaneSectionKey(roadId, sectionIndex)));
    selectLaneSection(roadId, sectionIndex);
  };

  const selectRoadChildLane = (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => {
    setExpandedRoads((prev) => new Set(prev).add(roadId));
    setExpandedLaneSections((prev) => new Set(prev).add(makeLaneSectionKey(roadId, sectionIndex)));
    selectLane(roadId, sectionIndex, side, laneId);
  };

  const isRoadSelected = (roadId: string) =>
    (selectedSceneNode?.type === 'road' && selectedSceneNode.roadId === roadId)
    || selectedRoadIds.includes(roadId);
  const isJunctionItemSelected = (junctionId: string) =>
    selectedJunctionId === junctionId || selectedJunctionIds.includes(junctionId);
  const isLaneSectionSelected = (roadId: string, sectionIndex: number) =>
    selectedSceneNode?.type === 'laneSection'
    && selectedSceneNode.roadId === roadId
    && selectedSceneNode.sectionIndex === sectionIndex;
  const isLaneSelected = (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) =>
    selectedSceneNode?.type === 'lane'
    && selectedSceneNode.roadId === roadId
    && selectedSceneNode.sectionIndex === sectionIndex
    && selectedSceneNode.side === side
    && selectedSceneNode.laneId === laneId;

  /** Called when the user clicks a road in the panel — select + pan viewport. */
  const handleSelectRoad = useCallback((roadId: string) => {
    selectionSourceRef.current = 'panel';
    selectRoad(roadId);
    emitViewportEvent({ type: 'pan-to-road', roadId });
  }, [selectRoad]);

  /** Called when the user clicks a junction in the panel — select + pan viewport. */
  const handleSelectJunction = useCallback((junctionId: string) => {
    selectionSourceRef.current = 'panel';
    selectJunction(junctionId);
    emitViewportEvent({ type: 'pan-to-junction', junctionId });
  }, [selectJunction]);

  const handleZoomToRoad = useCallback((roadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    emitViewportEvent({ type: 'zoom-to-selected', roadId });
  }, []);

  const handleZoomToJunction = useCallback((junctionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    emitViewportEvent({ type: 'zoom-to-junction', junctionId });
  }, []);

  const filteredRoads = project.roads;

  const filteredJunctions = project.junctions;

  const header = project.header;
  const loaded = hasProjectData(project);

  return (
    <div className="layer-panel">
      <div className="panel-header">
        <span>{t('layerPanel.header')}</span>
        <button
          className="panel-close-btn"
          onClick={() => useEditorViewStore.getState().toggleLeftPanel()}
          title={t('panel.close')}
        >
          <X size={12} />
        </button>
      </div>

      <div className="layer-cards">
        {/* Card 0: Map Info */}
        <div className="layer-card">
          <div
            className="layer-section-toggle"
            onClick={() => setMapInfoCollapsed(!mapInfoCollapsed)}
          >
            {mapInfoCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{t('layerPanel.mapInfo')}</span>
          </div>
          {!mapInfoCollapsed && (
            <div className="map-info-content">
              {loaded ? (
                <>
                  <div className="map-info-row">
                    <span className="map-info-label">{t('propertyPanel.name')}</span>
                    <span className="map-info-value">{header.name || project.name || '—'}</span>
                  </div>
                  <div className="map-info-row">
                    <span className="map-info-label">{t('layerPanel.revision')}</span>
                    <span className="map-info-value">{header.rev_major}.{header.rev_minor}</span>
                  </div>
                  <div className="map-info-row">
                    <span className="map-info-label">{t('layerPanel.date')}</span>
                    <span className="map-info-value">{header.date || '—'}</span>
                  </div>
                  <div className="map-info-row">
                    <span className="map-info-label">{t('layerPanel.geoReference')}</span>
                    <span className="map-info-value map-info-value-wrap">
                      {header.geo_reference
                        ? `${header.geo_reference.origin_lat.toFixed(6)}, ${header.geo_reference.origin_long.toFixed(6)}`
                        : t('layerPanel.noGeoRef')}
                    </span>
                  </div>
                  <div className="map-info-row">
                    <span className="map-info-label">{t('layerPanel.bounds')}</span>
                    <span className="map-info-value">
                      {t('layerPanel.north')}:{header.north.toFixed(1)} {t('layerPanel.south')}:{header.south.toFixed(1)} {t('layerPanel.east')}:{header.east.toFixed(1)} {t('layerPanel.west')}:{header.west.toFixed(1)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="map-info-empty">{t('layerPanel.noMapData')}</div>
              )}
            </div>
          )}
        </div>

        {/* Card 0.5: Display Settings */}
        <div className="layer-card">
          <div
            className="layer-section-toggle"
            onClick={() => setDisplaySettingsCollapsed(!displaySettingsCollapsed)}
          >
            {displaySettingsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{t('layerPanel.displaySettings')}</span>
          </div>
          {!displaySettingsCollapsed && (
            <div className="display-settings-content">
              {DISPLAY_TOGGLES.map((key) => (
                <label key={key} className="display-toggle-row">
                  <input
                    type="checkbox"
                    checked={display[key]}
                    onChange={() => toggleDisplaySetting(key)}
                  />
                  <span>{t(`layerPanel.${key}`)}</span>
                </label>
              ))}
              <div className="display-color-mode">
                <span className="display-color-mode-label">{t('layerPanel.colorMode')}</span>
                {(['single', 'byRoad', 'byLaneType'] as const).map((mode) => (
                  <label key={mode} className="display-radio-row">
                    <input
                      type="radio"
                      name="colorMode"
                      checked={display.colorMode === mode}
                      onChange={() => setColorMode(mode)}
                    />
                    <span>{t(`layerPanel.color${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Card 1: Layer categories — hidden until category filtering is implemented
        <div className="layer-card">
          <div
            className="layer-section-toggle"
            onClick={() => setCategoriesCollapsed(!categoriesCollapsed)}
          >
            {categoriesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{t('layerPanel.layers') || 'Layers'}</span>
          </div>
          {!categoriesCollapsed && (
            <div className="layer-categories">
              {LAYER_CATEGORIES.map((cat) => (
                <label key={cat.id} className="display-toggle-row">
                  <input
                    type="checkbox"
                    checked={layerVisibility[cat.id]}
                    onChange={() => toggleLayerVisibility(cat.id)}
                  />
                  {cat.icon}
                  <span>{t(cat.labelKey)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        */}

        {/* Card 2: Unified scene list — Roads first, then Junctions (flat, like C# version) */}
        <div className={`layer-card ${!sceneListCollapsed ? 'layer-card-grow' : ''}`}>
          <div
            className="layer-section-toggle"
            onClick={() => setSceneListCollapsed(!sceneListCollapsed)}
          >
            {sceneListCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>
              {t('layerPanel.sceneList')} ({t('layerPanel.roads')}: {filteredRoads.length}, {t('layerPanel.junctions')}: {filteredJunctions.length})
            </span>
          </div>
          {!sceneListCollapsed && (
          <div className="road-list">
            {/* Roads */}
            {filteredRoads.map((road) => (
              <div
                key={`road-${road.id}`}
                className="road-list-entry"
                ref={(el) => {
                  if (el) rowRefs.current.set(`road-${road.id}`, el);
                  else rowRefs.current.delete(`road-${road.id}`);
                }}
              >
                <div
                  className={`layer-item ${isRoadSelected(road.id) ? 'selected' : ''} ${!isRoadVisible(road.id) ? 'layer-item-hidden' : ''}`}
                  onClick={() => handleSelectRoad(road.id)}
                >
                  <button
                    className="road-expand"
                    onClick={(e) => { e.stopPropagation(); toggleRoadExpand(road.id); }}
                  >
                    {expandedRoads.has(road.id)
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                  </button>
                  <span className="layer-name">
                    {road.name || `Road(${road.id})`}
                    <span className="road-id"> ({road.id})</span>
                  </span>
                  <button
                    className="road-zoom-btn"
                    onClick={(e) => handleZoomToRoad(road.id, e)}
                    title={t('layerPanel.zoomTo')}
                  >
                    <Crosshair size={12} />
                  </button>
                  <button
                    className={`road-visibility ${isRoadVisible(road.id) ? '' : 'off'}`}
                    onClick={(e) => toggleRoadVisibility(road.id, e)}
                    title={isRoadVisible(road.id) ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
                  >
                    {isRoadVisible(road.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
                {expandedRoads.has(road.id) && (
                  <div className="road-details">
                    {road.lane_sections.map((ls, si) => (
                      <div
                        key={si}
                        className={`road-detail-lane-section ${expandedLaneSections.has(makeLaneSectionKey(road.id, si)) ? 'expanded' : ''}`}
                      >
                        <div
                          className={`layer-item layer-item-child layer-item-section ${isLaneSectionSelected(road.id, si) ? 'selected' : ''} ${!isLaneSectionVisible(road.id, si) ? 'layer-item-hidden' : ''}`}
                          onClick={() => selectRoadChildSection(road.id, si)}
                        >
                          <button
                            className="road-expand"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLaneSectionExpand(makeLaneSectionKey(road.id, si));
                            }}
                          >
                            {expandedLaneSections.has(makeLaneSectionKey(road.id, si))
                              ? <ChevronDown size={12} />
                              : <ChevronRight size={12} />
                            }
                          </button>
                          <span className="layer-name">
                            {t('layerPanel.laneSection')} #{si + 1}
                            <span className="road-id"> (s={ls.s.toFixed(1)})</span>
                          </span>
                          <button
                            className={`road-visibility ${isLaneSectionVisible(road.id, si) ? '' : 'off'}`}
                            onClick={(e) => toggleLaneSectionVisibility(makeLaneSectionKey(road.id, si), e)}
                            title={isLaneSectionVisible(road.id, si) ? t('layerPanel.hideLaneSection') : t('layerPanel.showLaneSection')}
                          >
                            {isLaneSectionVisible(road.id, si) ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        </div>
                        {expandedLaneSections.has(makeLaneSectionKey(road.id, si)) && (
                          <div className="lane-section-children">
                            {ls.left.map((lane) => (
                              <div
                                key={`l${lane.id}`}
                                className={`layer-item layer-item-child layer-item-lane ${isLaneSelected(road.id, si, 'left', lane.id) ? 'selected' : ''} ${!isLaneVisible(road.id, si, 'left', lane.id) ? 'layer-item-hidden' : ''}`}
                                onClick={() => selectRoadChildLane(road.id, si, 'left', lane.id)}
                              >
                                <span className="layer-name">
                                  {t('layerPanel.lane')} L{Math.abs(lane.id)}
                                  <span className="road-id"> ({lane.lane_type})</span>
                                </span>
                                <button
                                  className={`road-visibility ${isLaneVisible(road.id, si, 'left', lane.id) ? '' : 'off'}`}
                                  onClick={(e) => toggleLaneVisibility(road.id, si, 'left', lane.id, e)}
                                  title={isLaneVisible(road.id, si, 'left', lane.id) ? t('layerPanel.hideLane') : t('layerPanel.showLane')}
                                >
                                  {isLaneVisible(road.id, si, 'left', lane.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                                </button>
                              </div>
                            ))}
                            {ls.right.map((lane) => (
                              <div
                                key={`r${lane.id}`}
                                className={`layer-item layer-item-child layer-item-lane ${isLaneSelected(road.id, si, 'right', lane.id) ? 'selected' : ''} ${!isLaneVisible(road.id, si, 'right', lane.id) ? 'layer-item-hidden' : ''}`}
                                onClick={() => selectRoadChildLane(road.id, si, 'right', lane.id)}
                              >
                                <span className="layer-name">
                                  {t('layerPanel.lane')} R{Math.abs(lane.id)}
                                  <span className="road-id"> ({lane.lane_type})</span>
                                </span>
                                <button
                                  className={`road-visibility ${isLaneVisible(road.id, si, 'right', lane.id) ? '' : 'off'}`}
                                  onClick={(e) => toggleLaneVisibility(road.id, si, 'right', lane.id, e)}
                                  title={isLaneVisible(road.id, si, 'right', lane.id) ? t('layerPanel.hideLane') : t('layerPanel.showLane')}
                                >
                                  {isLaneVisible(road.id, si, 'right', lane.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Junctions (after roads, same level — flat tree) */}
            {filteredJunctions.map((junc) => (
              <div
                key={`junc-${junc.id}`}
                className="road-list-entry"
                ref={(el) => {
                  if (el) rowRefs.current.set(`junc-${junc.id}`, el);
                  else rowRefs.current.delete(`junc-${junc.id}`);
                }}
              >
                <div
                  className={`layer-item ${isJunctionItemSelected(junc.id) ? 'selected' : ''} ${!isJunctionVisible(junc.id) ? 'layer-item-hidden' : ''}`}
                  onClick={() => handleSelectJunction(junc.id)}
                >
                  <span className="road-expand road-expand-placeholder" />
                  <GitMerge size={12} className="junction-icon" />
                  <span className="layer-name">
                    {junc.name || `Junction(${junc.id})`}
                    <span className="road-id"> ({junc.id})</span>
                  </span>
                  <button
                    className="road-zoom-btn"
                    onClick={(e) => handleZoomToJunction(junc.id, e)}
                    title={t('layerPanel.zoomTo')}
                  >
                    <Crosshair size={12} />
                  </button>
                  <button
                    className={`road-visibility ${isJunctionVisible(junc.id) ? '' : 'off'}`}
                    onClick={(e) => toggleJunctionVisibility(junc.id, e)}
                    title={isJunctionVisible(junc.id) ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
                  >
                    {isJunctionVisible(junc.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
