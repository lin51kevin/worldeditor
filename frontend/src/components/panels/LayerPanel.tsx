import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useEditorViewStore } from '../../stores/editorViewStore';
import {
  makeLaneKey,
  makeLaneSectionKey,
  type LaneSide,
} from '../../utils/sceneGraph';
import { emitViewportEvent } from '../../viewport/viewportEvents';
import { JunctionLayerItem } from './layer/JunctionLayerItem';
import { RoadLayerItem } from './layer/RoadLayerItem';
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
  const selectSignal = useEditorStore((s) => s.selectSignal);
  const selectObject = useEditorStore((s) => s.selectObject);
  const {
    display,
    toggleDisplaySetting,
    setColorMode,
    toggleRoadVisibility: toggleRoadVisibilityInStore,
    toggleJunctionVisibility: toggleJunctionVisibilityInStore,
    toggleLaneSectionVisibility: toggleLaneSectionVisibilityInStore,
    toggleLaneVisibility: toggleLaneVisibilityInStore,
    toggleSignalVisibility: toggleSignalVisibilityInStore,
    toggleObjectVisibility: toggleObjectVisibilityInStore,
  } = useEditorViewStore();
  const [expandedRoads, setExpandedRoads] = useState<Set<string>>(new Set());
  const [expandedLaneSections, setExpandedLaneSections] = useState<Set<string>>(new Set());
  const [expandedRoadSignals, setExpandedRoadSignals] = useState<Set<string>>(new Set());
  const [expandedRoadObjects, setExpandedRoadObjects] = useState<Set<string>>(new Set());
  const [mapInfoCollapsed, setMapInfoCollapsed] = useState(true);
  const [displaySettingsCollapsed, setDisplaySettingsCollapsed] = useState(true);
  const [sceneListCollapsed, setSceneListCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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
      el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
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

  const toggleRoadSignalsExpand = (roadId: string) => {
    setExpandedRoadSignals((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  };

  const toggleRoadObjectsExpand = (roadId: string) => {
    setExpandedRoadObjects((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  };

  const toggleRoadVisibility = (roadId: string) => {
    toggleRoadVisibilityInStore(roadId);
  };

  const toggleJunctionVisibility = (junctionId: string) => {
    toggleJunctionVisibilityInStore(junctionId);
  };

  const toggleLaneSectionVisibility = (sectionKey: string) => {
    toggleLaneSectionVisibilityInStore(sectionKey);
  };

  const toggleLaneVisibility = (
    roadId: string,
    sectionIndex: number,
    side: LaneSide,
    laneId: number,
  ) => {
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
  const isSignalVisible = (roadId: string, signalId: string) =>
    !( display.hiddenSignalKeys ?? []).includes(`${roadId}::signal::${signalId}`);
  const isObjectVisible = (roadId: string, objectId: string) =>
    !(display.hiddenObjectKeys ?? []).includes(`${roadId}::object::${objectId}`);

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

  const handleSelectSignal = useCallback((roadId: string, signalId: string) => {
    selectionSourceRef.current = 'panel';
    setExpandedRoads((prev) => new Set(prev).add(roadId));
    setExpandedRoadSignals((prev) => new Set(prev).add(roadId));
    selectSignal(roadId, signalId);
    emitViewportEvent({ type: 'pan-to-signal', roadId, signalId });
  }, [selectSignal]);

  const handleSelectObject = useCallback((roadId: string, objectId: string) => {
    selectionSourceRef.current = 'panel';
    setExpandedRoads((prev) => new Set(prev).add(roadId));
    setExpandedRoadObjects((prev) => new Set(prev).add(roadId));
    selectObject(roadId, objectId);
    emitViewportEvent({ type: 'pan-to-object', roadId, objectId });
  }, [selectObject]);

  const handleZoomToRoad = useCallback((roadId: string) => {
    emitViewportEvent({ type: 'zoom-to-selected', roadId });
  }, []);

  const handleZoomToJunction = useCallback((junctionId: string) => {
    emitViewportEvent({ type: 'zoom-to-junction', junctionId });
  }, []);

  const registerRowRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) rowRefs.current.set(id, element);
    else rowRefs.current.delete(id);
  }, []);

  const filteredRoads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return project.roads;
    return project.roads.filter(
      (r) => r.id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q),
    );
  }, [project.roads, searchQuery]);

  const filteredJunctions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return project.junctions;
    return project.junctions.filter(
      (j) => j.id.toLowerCase().includes(q) || (j.name || '').toLowerCase().includes(q),
    );
  }, [project.junctions, searchQuery]);

  const header = project.header;
  const loaded = hasProjectData(project);

  return (
    <div className="layer-panel">
      <div className="panel-header">
        <span>{t('layerPanel.header')}</span>
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
              {t('layerPanel.sceneList')}{' '}
              {searchQuery.trim()
                ? `(${t('layerPanel.roads')}: ${t('layerPanel.filteredCount', { count: filteredRoads.length, total: project.roads.length })}, ${t('layerPanel.junctions')}: ${t('layerPanel.filteredCount', { count: filteredJunctions.length, total: project.junctions.length })})`
                : `(${t('layerPanel.roads')}: ${filteredRoads.length}, ${t('layerPanel.junctions')}: ${filteredJunctions.length})`}
            </span>
          </div>
          {!sceneListCollapsed && (
            <>
              <div className="search-bar">
                <Search size={12} className="search-icon" />
                <input
                  className="search-input"
                  type="text"
                  value={searchQuery}
                  placeholder={t('layerPanel.searchPlaceholder')}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value) setSceneListCollapsed(false);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear">
                    <X size={12} />
                  </button>
                )}
              </div>
          <div className="road-list">
            {/* Roads */}
            {filteredRoads.map((road) => (
              <RoadLayerItem
                key={`road-${road.id}`}
                road={road}
                selectedSceneNode={selectedSceneNode}
                isSelected={isRoadSelected(road.id)}
                isVisible={isRoadVisible(road.id)}
                isExpanded={expandedRoads.has(road.id)}
                signalsExpanded={expandedRoadSignals.has(road.id)}
                objectsExpanded={expandedRoadObjects.has(road.id)}
                laneSectionsExpanded={expandedLaneSections}
                entryRef={(element) => registerRowRef(`road-${road.id}`, element)}
                isLaneSectionSelected={(sectionIndex) => isLaneSectionSelected(road.id, sectionIndex)}
                isLaneSelected={(sectionIndex, side, laneId) => isLaneSelected(road.id, sectionIndex, side, laneId)}
                isLaneSectionVisible={(sectionIndex) => isLaneSectionVisible(road.id, sectionIndex)}
                isLaneVisible={(sectionIndex, side, laneId) => isLaneVisible(road.id, sectionIndex, side, laneId)}
                onSelect={() => handleSelectRoad(road.id)}
                onToggleExpand={() => toggleRoadExpand(road.id)}
                onZoom={() => handleZoomToRoad(road.id)}
                onToggleVisibility={() => toggleRoadVisibility(road.id)}
                onSelectLaneSection={(sectionIndex) => selectRoadChildSection(road.id, sectionIndex)}
                onToggleLaneSectionExpand={(sectionIndex) => toggleLaneSectionExpand(makeLaneSectionKey(road.id, sectionIndex))}
                onToggleLaneSectionVisibility={(sectionIndex) => toggleLaneSectionVisibility(makeLaneSectionKey(road.id, sectionIndex))}
                onSelectLane={(sectionIndex, side, laneId) => selectRoadChildLane(road.id, sectionIndex, side, laneId)}
                onToggleLaneVisibility={(sectionIndex, side, laneId) => toggleLaneVisibility(road.id, sectionIndex, side, laneId)}
                onToggleSignalsExpand={() => toggleRoadSignalsExpand(road.id)}
                onSelectSignal={(signalId) => handleSelectSignal(road.id, signalId)}
                onToggleSignalVisibility={(signalId) => toggleSignalVisibilityInStore(road.id, signalId)}
                isSignalVisible={(signalId) => isSignalVisible(road.id, signalId)}
                onToggleObjectsExpand={() => toggleRoadObjectsExpand(road.id)}
                onSelectObject={(objectId) => handleSelectObject(road.id, objectId)}
                onToggleObjectVisibility={(objectId) => toggleObjectVisibilityInStore(road.id, objectId)}
                isObjectVisible={(objectId) => isObjectVisible(road.id, objectId)}
              />
            ))}

            {/* Junctions (after roads, same level — flat tree) */}
            {filteredJunctions.map((junc) => (
              <JunctionLayerItem
                key={`junc-${junc.id}`}
                junction={junc}
                isSelected={isJunctionItemSelected(junc.id)}
                isVisible={isJunctionVisible(junc.id)}
                entryRef={(element) => registerRowRef(`junc-${junc.id}`, element)}
                onSelect={() => handleSelectJunction(junc.id)}
                onZoom={() => handleZoomToJunction(junc.id)}
                onToggleVisibility={() => toggleJunctionVisibility(junc.id)}
              />
            ))}
          </div>
          {filteredRoads.length === 0 && filteredJunctions.length === 0 && searchQuery.trim() && (
            <div className="scene-list-empty">{t('layerPanel.noSearchResults')}</div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
