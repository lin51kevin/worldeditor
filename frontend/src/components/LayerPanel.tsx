import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Spline, Route,
  Eye, EyeOff, ChevronRight, ChevronDown,
  Search,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import './LayerPanel.css';

interface LayerCategory {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
}

const LAYER_CATEGORIES: LayerCategory[] = [
  { id: 'vector',     labelKey: 'layerPanel.vector',     icon: <Spline size={14} /> },
  { id: 'road',       labelKey: 'layerPanel.road',       icon: <Route size={14} /> },
];

export function LayerPanel() {
  const { project, selectedRoadId, selectRoad } = useEditorStore();
  const [activeLayer, setActiveLayer] = useState('road');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_CATEGORIES.map((c) => [c.id, true])),
  );
  const [expandedRoads, setExpandedRoads] = useState<Set<string>>(new Set());
  const [roadVisibility, setRoadVisibility] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(false);
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

  const toggleRoadVisibility = (roadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRoadVisibility((prev) => ({ ...prev, [roadId]: prev[roadId] === false ? true : false }));
  };

  const isRoadVisible = (roadId: string) => roadVisibility[roadId] !== false;

  const filteredRoads = useMemo(() => {
    if (!searchQuery.trim()) return project.roads;
    const q = searchQuery.toLowerCase();
    return project.roads.filter(
      (road) =>
        road.id.toLowerCase().includes(q) ||
        (road.name || '').toLowerCase().includes(q),
    );
  }, [project.roads, searchQuery]);

  return (
    <div className="layer-panel">
      <div className="panel-header">{t('layerPanel.header')}</div>

      {/* Search */}
      <div className="navigator-search">
        <Search size={12} className="navigator-search-icon" />
        <input
          className="navigator-search-input"
          type="text"
          placeholder={t('layerPanel.searchPlaceholder') || 'Search...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Layer categories — collapsible */}
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
            <div
              key={cat.id}
              className={`layer-category ${activeLayer === cat.id ? 'active' : ''}`}
              onClick={() => setActiveLayer(cat.id)}
            >
              <button
                className={`layer-visibility ${layerVisibility[cat.id] ? 'visible' : 'hidden'}`}
                onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(cat.id); }}
                title={layerVisibility[cat.id] ? t('layerPanel.hideLayer') : t('layerPanel.showLayer')}
              >
                {layerVisibility[cat.id] ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <span className="layer-cat-icon">{cat.icon}</span>
              <span className="layer-cat-label">{t(cat.labelKey)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Road list */}
      <div className="road-list-container">
        <div className="road-list-header">
          {t('layerPanel.roadList')} ({filteredRoads.length}
          {searchQuery && filteredRoads.length !== project.roads.length
            ? ` / ${project.roads.length}`
            : ''
          })
        </div>
        <div className="road-list">
          {filteredRoads.map((road) => (
            <div key={road.id} className="road-list-entry">
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
                  className={`road-visibility ${isRoadVisible(road.id) ? '' : 'off'}`}
                  onClick={(e) => toggleRoadVisibility(road.id, e)}
                  title={isRoadVisible(road.id) ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
                >
                  {isRoadVisible(road.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
              {expandedRoads.has(road.id) && (
                <div className="road-details">
                  <div className="road-detail-item">{t('layerPanel.geometry')}: {road.plan_view.length} {t('propertyPanel.segments')}</div>
                  <div className="road-detail-item">{t('layerPanel.laneSections')}: {road.lane_sections.length}</div>
                  <div className="road-detail-item">{t('layerPanel.length')}: {road.length.toFixed(1)}m</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
