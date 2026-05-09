import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Spline, Route,
  Eye, EyeOff, ChevronRight, ChevronDown,
  Crosshair, GitMerge,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import type { GeometryType } from '../services/platform';
import './LayerPanel.css';

interface LayerCategory {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
}

const LAYER_CATEGORIES: LayerCategory[] = [
  { id: 'vector', labelKey: 'layerPanel.vector', icon: <Spline size={14} /> },
  { id: 'road',   labelKey: 'layerPanel.road',   icon: <Route size={14} /> },
];

const DISPLAY_TOGGLES = [
  'showRoadMesh',
  'showLaneLines',
  'showRoadMarks',
  'showReferenceLine',
  'showSignals',
  'showObjects',
] as const;

function geoTypeName(gt: GeometryType): string {
  if (typeof gt === 'string') return gt;
  return Object.keys(gt)[0] ?? 'Unknown';
}

/** Check whether the project has any real data loaded (non-empty roads or header name). */
function hasProjectData(project: { roads: unknown[]; junctions: unknown[]; header: { name: string } }): boolean {
  return project.roads.length > 0 || project.junctions.length > 0 || !!project.header.name;
}

export function LayerPanel() {
  const { project, selectedRoadId, selectRoad, selectedJunctionId, selectJunction } = useEditorStore();
  const { display, toggleDisplaySetting, setColorMode } = useEditorViewStore();
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_CATEGORIES.map((c) => [c.id, true])),
  );
  const [expandedRoads, setExpandedRoads] = useState<Set<string>>(new Set());
  const [expandedJunctions, setExpandedJunctions] = useState<Set<string>>(new Set());
  const [roadVisibility, setRoadVisibility] = useState<Record<string, boolean>>({});
  const [mapInfoCollapsed, setMapInfoCollapsed] = useState(true);
  const [displaySettingsCollapsed, setDisplaySettingsCollapsed] = useState(true);
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(false);
  const [sceneListCollapsed, setSceneListCollapsed] = useState(false);
  const { t } = useTranslation();

  const toggleLayerVisibility = (id: string) => {
    setLayerVisibility((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleRoadExpand = (roadId: string) => {
    setExpandedRoads((prev) => {
      const next = new Set(prev);
      if (next.has(roadId)) next.delete(roadId); else next.add(roadId);
      return next;
    });
  };

  const toggleJunctionExpand = (junctionId: string) => {
    setExpandedJunctions((prev) => {
      const next = new Set(prev);
      if (next.has(junctionId)) next.delete(junctionId); else next.add(junctionId);
      return next;
    });
  };

  const toggleRoadVisibility = (roadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRoadVisibility((prev) => ({ ...prev, [roadId]: prev[roadId] === false ? true : false }));
  };

  const isRoadVisible = (roadId: string) => roadVisibility[roadId] !== false;

  const handleZoomToRoad = useCallback((roadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    emitViewportEvent({ type: 'zoom-to-selected', roadId });
  }, []);

  const filteredRoads = project.roads;

  const filteredJunctions = project.junctions;

  const header = project.header;
  const loaded = hasProjectData(project);

  return (
    <div className="layer-panel">
      <div className="panel-header">{t('layerPanel.header')}</div>

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

        {/* Card 1: Layer categories */}
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

        {/* Card 2: Unified scene list — Roads first, then Junctions (flat, like C# version) */}
        <div className="layer-card layer-card-grow">
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
              <div key={`road-${road.id}`} className="road-list-entry">
                <div
                  className={`layer-item ${selectedRoadId === road.id ? 'selected' : ''}`}
                  onClick={() => selectRoad(road.id)}
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
                    <div className="road-detail-item">{t('layerPanel.length')}: {road.length.toFixed(1)}m</div>
                    {/* Geometry segments */}
                    <div className="road-detail-sub-header">{t('layerPanel.geometry')} ({road.plan_view.length})</div>
                    {road.plan_view.map((geo, i) => (
                      <div key={i} className="road-detail-item road-detail-indent">
                        #{i + 1} {geoTypeName(geo.geo_type)} — s={geo.s.toFixed(1)}, L={geo.length.toFixed(1)}m
                      </div>
                    ))}
                    {/* Lane sections */}
                    <div className="road-detail-sub-header">{t('layerPanel.laneSections')} ({road.lane_sections.length})</div>
                    {road.lane_sections.map((ls, si) => (
                      <div key={si} className="road-detail-lane-section">
                        <div className="road-detail-item road-detail-indent">
                          §{si + 1} (s={ls.s})
                        </div>
                        {ls.left.map((lane) => (
                          <div key={`l${lane.id}`} className="road-detail-item road-detail-indent2">
                            L{Math.abs(lane.id)}: {lane.lane_type}
                          </div>
                        ))}
                        {ls.right.map((lane) => (
                          <div key={`r${lane.id}`} className="road-detail-item road-detail-indent2">
                            R{Math.abs(lane.id)}: {lane.lane_type}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Junctions (after roads, same level — flat tree) */}
            {filteredJunctions.map((junc) => (
              <div key={`junc-${junc.id}`} className="road-list-entry">
                <div
                  className={`layer-item ${selectedJunctionId === junc.id ? 'selected' : ''}`}
                  onClick={() => selectJunction(junc.id)}
                >
                  <button
                    className="road-expand"
                    onClick={(e) => { e.stopPropagation(); toggleJunctionExpand(junc.id); }}
                  >
                    {expandedJunctions.has(junc.id)
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                  </button>
                  <GitMerge size={12} className="junction-icon" />
                  <span className="layer-name">
                    {junc.name || `Junction(${junc.id})`}
                    <span className="road-id"> ({junc.id})</span>
                  </span>
                </div>
                {expandedJunctions.has(junc.id) && (
                  <div className="road-details">
                    <div className="road-detail-sub-header">
                      {t('layerPanel.connections')} ({junc.connections.length})
                    </div>
                    {junc.connections.map((conn) => (
                      <div key={conn.id} className="road-detail-item road-detail-indent">
                        {t('layerPanel.incoming')}:{conn.incoming_road} → {t('layerPanel.connecting')}:{conn.connecting_road} ({conn.contact_point})
                        {conn.lane_links.length > 0 && (
                          <span className="junction-lane-links"> [{conn.lane_links.map((ll) => `${ll.from}→${ll.to}`).join(', ')}]</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
