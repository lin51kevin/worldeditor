import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import {
  makeLaneKey,
  makeLaneSectionKey,
  type LaneSide,
} from '../../utils/sceneGraph';
import { emitViewportEvent } from '../../viewport/viewportEvents';
import { JunctionLayerItem } from './layer/JunctionLayerItem';
import { RoadLayerItem } from './layer/RoadLayerItem';
import { VirtualList } from '../shared/VirtualList';
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
  const project = useProjectStore((s) => s.project);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  const selectedRoadIds = useProjectStore((s) => s.selectedRoadIds);
  const selectedJunctionIds = useProjectStore((s) => s.selectedJunctionIds);
  const selectRoad = useProjectStore((s) => s.selectRoad);
  const selectJunction = useProjectStore((s) => s.selectJunction);
  const selectLaneSection = useProjectStore((s) => s.selectLaneSection);
  const selectLane = useProjectStore((s) => s.selectLane);
  const selectSignal = useProjectStore((s) => s.selectSignal);
  const selectObject = useProjectStore((s) => s.selectObject);
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
  } = useViewportStore();
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

  // Auto-scroll to the selected road/junction/signal/object when selection originates from viewport
  useEffect(() => {
    if (selectionSourceRef.current === 'panel') {
      selectionSourceRef.current = 'viewport';
      return;
    }

    let id: string | null = null;

    if (selectedSceneNode?.type === 'signal') {
      const { roadId, signalId } = selectedSceneNode;
      // Ensure road row + signals group are expanded so the item is reachable
      setSceneListCollapsed(false);
      setExpandedRoads((prev) => new Set(prev).add(roadId));
      setExpandedRoadSignals((prev) => new Set(prev).add(roadId));
      id = `signal-${roadId}-${signalId}`;
    } else if (selectedSceneNode?.type === 'object') {
      const { roadId, objectId } = selectedSceneNode;
      setSceneListCollapsed(false);
      setExpandedRoads((prev) => new Set(prev).add(roadId));
      setExpandedRoadObjects((prev) => new Set(prev).add(roadId));
      id = `object-${roadId}-${objectId}`;
    } else if (selectedSceneNode?.type === 'laneSection') {
      const { roadId, sectionIndex } = selectedSceneNode;
      setSceneListCollapsed(false);
      setExpandedRoads((prev) => new Set(prev).add(roadId));
      setExpandedLaneSections((prev) => new Set(prev).add(makeLaneSectionKey(roadId, sectionIndex)));
      id = `lsec-${roadId}-${sectionIndex}`;
    } else if (selectedSceneNode?.type === 'lane') {
      const { roadId, sectionIndex, side, laneId } = selectedSceneNode;
      setSceneListCollapsed(false);
      setExpandedRoads((prev) => new Set(prev).add(roadId));
      setExpandedLaneSections((prev) => new Set(prev).add(makeLaneSectionKey(roadId, sectionIndex)));
      id = `lane-${roadId}-${sectionIndex}-${side}-${laneId}`;
    } else {
      id = selectedRoadId ? `road-${selectedRoadId}` : selectedJunctionId ? `junc-${selectedJunctionId}` : null;
      if (id) setSceneListCollapsed(false);
    }

    if (!id) return;
    // Double rAF ensures expand animation completes before scrolling
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = rowRefs.current.get(id!);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [selectedRoadId, selectedJunctionId, selectedSceneNode]);


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
    return project.roads.filter((r) => {
      if (r.id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)) return true;
      // Match signals
      if ((r.signals ?? []).some((s) =>
        s.id.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        s.signal_type.toLowerCase().includes(q) ||
        (s.signal_subtype || '').toLowerCase().includes(q),
      )) return true;
      // Match objects
      if ((r.objects ?? []).some((o) => {
        const typeStr = typeof o.object_type === 'string' ? o.object_type : o.object_type.Custom;
        return o.id.toLowerCase().includes(q) ||
          (o.name || '').toLowerCase().includes(q) ||
          typeStr.toLowerCase().includes(q);
      })) return true;
      return false;
    });
  }, [project.roads, searchQuery]);

  // When searching, auto-expand roads whose match comes from a child (signal/object)
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    project.roads.forEach((r) => {
      const roadSelfMatch = r.id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
      if (roadSelfMatch) return;
      const signalMatch = (r.signals ?? []).some((s) =>
        s.id.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q) ||
        s.signal_type.toLowerCase().includes(q) || (s.signal_subtype || '').toLowerCase().includes(q),
      );
      const objectMatch = (r.objects ?? []).some((o) => {
        const typeStr = typeof o.object_type === 'string' ? o.object_type : o.object_type.Custom;
        return o.id.toLowerCase().includes(q) || (o.name || '').toLowerCase().includes(q) || typeStr.toLowerCase().includes(q);
      });
      if (signalMatch || objectMatch) {
        setExpandedRoads((prev) => new Set(prev).add(r.id));
        if (signalMatch) setExpandedRoadSignals((prev) => new Set(prev).add(r.id));
        if (objectMatch) setExpandedRoadObjects((prev) => new Set(prev).add(r.id));
      }
    });
  }, [searchQuery, project.roads]);

  const filteredJunctions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return project.junctions;
    return project.junctions.filter(
      (j) => j.id.toLowerCase().includes(q) || (j.name || '').toLowerCase().includes(q),
    );
  }, [project.junctions, searchQuery]);

  const sceneListItems = useMemo(() => {
    const result: { key: string; element: ReactNode }[] = [];
    for (const road of filteredRoads) {
      result.push({
        key: `road-${road.id}`,
        element: (
          <RoadLayerItem
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
            registerLaneSectionRef={(sectionIndex, el) => registerRowRef(`lsec-${road.id}-${sectionIndex}`, el)}
            registerLaneRef={(sectionIndex, side, laneId, el) => registerRowRef(`lane-${road.id}-${sectionIndex}-${side}-${laneId}`, el)}
            registerSignalRef={(signalId, el) => registerRowRef(`signal-${road.id}-${signalId}`, el)}
            onToggleObjectsExpand={() => toggleRoadObjectsExpand(road.id)}
            onSelectObject={(objectId) => handleSelectObject(road.id, objectId)}
            onToggleObjectVisibility={(objectId) => toggleObjectVisibilityInStore(road.id, objectId)}
            isObjectVisible={(objectId) => isObjectVisible(road.id, objectId)}
            registerObjectRef={(objectId, el) => registerRowRef(`object-${road.id}-${objectId}`, el)}
          />
        ),
      });
    }
    for (const junc of filteredJunctions) {
      result.push({
        key: `junc-${junc.id}`,
        element: (
          <JunctionLayerItem
            junction={junc}
            isSelected={isJunctionItemSelected(junc.id)}
            isVisible={isJunctionVisible(junc.id)}
            entryRef={(element) => registerRowRef(`junc-${junc.id}`, element)}
            onSelect={() => handleSelectJunction(junc.id)}
            onZoom={() => handleZoomToJunction(junc.id)}
            onToggleVisibility={() => toggleJunctionVisibility(junc.id)}
          />
        ),
      });
    }
    return result;
  }, [filteredRoads, filteredJunctions, selectedSceneNode, expandedRoads, expandedRoadSignals, expandedRoadObjects, expandedLaneSections, registerRowRef, isRoadSelected, isRoadVisible, isLaneSectionSelected, isLaneSelected, isLaneSectionVisible, isLaneVisible, isJunctionItemSelected, isJunctionVisible, handleSelectRoad, toggleRoadExpand, handleZoomToRoad, toggleRoadVisibility, selectRoadChildSection, toggleLaneSectionExpand, toggleLaneSectionVisibility, selectRoadChildLane, toggleLaneVisibility, toggleRoadSignalsExpand, handleSelectSignal, toggleSignalVisibilityInStore, isSignalVisible, toggleRoadObjectsExpand, handleSelectObject, toggleObjectVisibilityInStore, isObjectVisible, handleSelectJunction, handleZoomToJunction, toggleJunctionVisibility]);

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
          <VirtualList
            items={sceneListItems}
            height={Math.min(600, Math.max(300, window.innerHeight - 300))}
            estimatedItemHeight={36}
            overscan={5}
            className="road-list"
            getItemKey={(item) => item.key}
            renderItem={(item) => item.element}
          />
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
