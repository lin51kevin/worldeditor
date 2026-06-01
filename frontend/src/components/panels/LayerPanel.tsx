import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import {
  makeLaneSectionKey,
} from '../../utils/sceneGraph';
import { flattenLayerTree } from './layer/flattenLayerTree';
import { VirtualLayerRow } from './layer/VirtualLayerRow';
import { ROW_HEIGHT, INDENT_PER_LEVEL } from './layer/virtualLayerTypes';
import './LayerPanel.css';

const DISPLAY_TOGGLES = [
  'showLaneLines',
  'showRoadMarks',
  'showReferenceLine',
  'showSignals',
  'showObjects',
] as const;

export function LayerPanel() {
  const roads = useProjectStore((s) => s.project.roads);
  const junctions = useProjectStore((s) => s.project.junctions);
  const header = useProjectStore((s) => s.project.header);
  const projectName = useProjectStore((s) => s.project.name);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  const {
    display,
    toggleDisplaySetting,
    setColorMode,
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

  // Refs for auto-scroll
  const selectionSourceRef = useRef<'panel' | 'viewport'>('viewport');
  const [pendingScrollTarget, setPendingScrollTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track selection source from panel clicks
  const markSelectionFromPanel = useCallback(() => {
    selectionSourceRef.current = 'panel';
  }, []);

  // Auto-scroll to the selected item when selection originates from viewport
  useEffect(() => {
    if (selectionSourceRef.current === 'panel') {
      selectionSourceRef.current = 'viewport';
      return;
    }

    let id: string | null;

    if (selectedSceneNode?.type === 'signal') {
      const { roadId, signalId } = selectedSceneNode;
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
      const { roadId, sectionIndex } = selectedSceneNode;
      setSceneListCollapsed(false);
      setExpandedRoads((prev) => new Set(prev).add(roadId));
      setExpandedLaneSections((prev) => new Set(prev).add(makeLaneSectionKey(roadId, sectionIndex)));
      id = `lane-${roadId}-${sectionIndex}-${selectedSceneNode.side}-${selectedSceneNode.laneId}`;
    } else {
      id = selectedRoadId ? `road-${selectedRoadId}` : selectedJunctionId ? `junc-${selectedJunctionId}` : null;
      if (id) setSceneListCollapsed(false);
    }

    // Store the target for the scroll effect (resolved after flatItems updates)
    setPendingScrollTarget(id);
  }, [selectedRoadId, selectedJunctionId, selectedSceneNode]);

  const toggleRoadExpand = useCallback((roadId: string) => {
    setExpandedRoads((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  }, []);

  const toggleLaneSectionExpand = useCallback((sectionKey: string) => {
    setExpandedLaneSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey);
      return next;
    });
  }, []);

  const toggleRoadSignalsExpand = useCallback((roadId: string) => {
    setExpandedRoadSignals((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  }, []);

  const toggleRoadObjectsExpand = useCallback((roadId: string) => {
    setExpandedRoadObjects((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  }, []);

  const ensureLaneSectionExpand = useCallback((sectionKey: string) => {
    setExpandedLaneSections((prev) => {
      if (prev.has(sectionKey)) return prev;
      return new Set(prev).add(sectionKey);
    });
  }, []);

  const filteredRoads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roads;
    return roads.filter((r) => {
      if (r.id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)) return true;
      if ((r.signals ?? []).some((s) =>
        s.id.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        s.signal_type.toLowerCase().includes(q) ||
        (s.signal_subtype || '').toLowerCase().includes(q),
      )) return true;
      if ((r.objects ?? []).some((o) => {
        const typeStr = typeof o.object_type === 'string' ? o.object_type : o.object_type.Custom;
        return o.id.toLowerCase().includes(q) ||
          (o.name || '').toLowerCase().includes(q) ||
          typeStr.toLowerCase().includes(q);
      })) return true;
      return false;
    });
  }, [roads, searchQuery]);

  // When searching, auto-expand roads whose match comes from a child
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    roads.forEach((r) => {
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
  }, [searchQuery, roads]);

  const filteredJunctions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return junctions;
    return junctions.filter(
      (j) => j.id.toLowerCase().includes(q) || (j.name || '').toLowerCase().includes(q),
    );
  }, [junctions, searchQuery]);

  // Flatten tree into virtual list items
  const flatItems = useMemo(
    () => flattenLayerTree(
      filteredRoads,
      filteredJunctions,
      expandedRoads,
      expandedLaneSections,
      expandedRoadSignals,
      expandedRoadObjects,
      searchQuery,
    ),
    [filteredRoads, filteredJunctions, expandedRoads, expandedLaneSections, expandedRoadSignals, expandedRoadObjects, searchQuery],
  );

  // Virtual list
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  // Resolve pending scroll target after flatItems updates (items become visible after expand)
  useEffect(() => {
    if (!pendingScrollTarget) return;

    const index = flatItems.findIndex((item) => {
      switch (item.type) {
        case 'road': return `road-${item.roadId}` === pendingScrollTarget;
        case 'laneSection': return `lsec-${item.roadId}-${item.sectionIndex}` === pendingScrollTarget;
        case 'lane': return `lane-${item.roadId}-${item.sectionIndex}-${item.side}-${item.laneId}` === pendingScrollTarget;
        case 'signal': return `signal-${item.roadId}-${item.signalId}` === pendingScrollTarget;
        case 'object': return `object-${item.roadId}-${item.objectId}` === pendingScrollTarget;
        case 'junction': return `junc-${item.junctionId}` === pendingScrollTarget;
        default: return false;
      }
    });

    if (index >= 0) {
      setPendingScrollTarget(null);
      // Use rAF to ensure the virtualizer has processed the updated count
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
      });
    }
  }, [flatItems, pendingScrollTarget, virtualizer]);

  const loaded = roads.length > 0 || junctions.length > 0 || !!header.name;

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
                    <span className="map-info-value">{header.name || projectName || '—'}</span>
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

        {/* Card 2: Virtualized scene list */}
        <div className={`layer-card ${!sceneListCollapsed ? 'layer-card-grow' : ''}`}>
          <div
            className="layer-section-toggle"
            onClick={() => setSceneListCollapsed(!sceneListCollapsed)}
          >
            {sceneListCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>
              {t('layerPanel.sceneList')}{' '}
              {searchQuery.trim()
                ? `(${t('layerPanel.roads')}: ${t('layerPanel.filteredCount', { count: filteredRoads.length, total: roads.length })}, ${t('layerPanel.junctions')}: ${t('layerPanel.filteredCount', { count: filteredJunctions.length, total: junctions.length })})`
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
              <div className="road-list" ref={scrollRef}>
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const item = flatItems[virtualItem.index]!;
                    return (
                      <div
                        key={virtualItem.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                          paddingLeft: item.depth > 0 ? `${item.depth * INDENT_PER_LEVEL}px` : undefined,
                          boxSizing: 'border-box',
                        }}
                      >
                        <VirtualLayerRow
                          item={item}
                          expandedRoads={expandedRoads}
                          expandedLaneSections={expandedLaneSections}
                          expandedRoadSignals={expandedRoadSignals}
                          expandedRoadObjects={expandedRoadObjects}
                          onToggleRoadExpand={toggleRoadExpand}
                          onToggleLaneSectionExpand={toggleLaneSectionExpand}
                          onEnsureLaneSectionExpand={ensureLaneSectionExpand}
                          onToggleRoadSignalsExpand={toggleRoadSignalsExpand}
                          onToggleRoadObjectsExpand={toggleRoadObjectsExpand}
                          onSelectionFromPanel={markSelectionFromPanel}
                        />
                      </div>
                    );
                  })}
                </div>
                {flatItems.length === 0 && searchQuery.trim() && (
                  <div className="scene-list-empty">{t('layerPanel.noSearchResults')}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
