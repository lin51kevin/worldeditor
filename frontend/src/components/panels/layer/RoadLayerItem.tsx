import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Road } from '../../../services/platform';
import { makeLaneSectionKey, type LaneSide, type SceneNodeSelection } from '../../../utils/sceneGraph';

export interface RoadLayerItemProps {
  road: Road;
  selectedSceneNode: SceneNodeSelection | null;
  isSelected: boolean;
  isVisible: boolean;
  isExpanded: boolean;
  signalsExpanded: boolean;
  objectsExpanded: boolean;
  laneSectionsExpanded: Set<string>;
  entryRef?: (element: HTMLDivElement | null) => void;
  isLaneSectionSelected: (sectionIndex: number) => boolean;
  isLaneSelected: (sectionIndex: number, side: LaneSide, laneId: number) => boolean;
  isLaneSectionVisible: (sectionIndex: number) => boolean;
  isLaneVisible: (sectionIndex: number, side: LaneSide, laneId: number) => boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onZoom: () => void;
  onToggleVisibility: () => void;
  onSelectLaneSection: (sectionIndex: number) => void;
  onToggleLaneSectionExpand: (sectionIndex: number) => void;
  onToggleLaneSectionVisibility: (sectionIndex: number) => void;
  onSelectLane: (sectionIndex: number, side: LaneSide, laneId: number) => void;
  onToggleLaneVisibility: (sectionIndex: number, side: LaneSide, laneId: number) => void;
  onToggleSignalsExpand: () => void;
  onSelectSignal: (signalId: string) => void;
  onToggleObjectsExpand: () => void;
  onSelectObject: (objectId: string) => void;
}

export function RoadLayerItem({
  road,
  selectedSceneNode,
  isSelected,
  isVisible,
  isExpanded,
  signalsExpanded,
  objectsExpanded,
  laneSectionsExpanded,
  entryRef,
  isLaneSectionSelected,
  isLaneSelected,
  isLaneSectionVisible,
  isLaneVisible,
  onSelect,
  onToggleExpand,
  onZoom,
  onToggleVisibility,
  onSelectLaneSection,
  onToggleLaneSectionExpand,
  onToggleLaneSectionVisibility,
  onSelectLane,
  onToggleLaneVisibility,
  onToggleSignalsExpand,
  onSelectSignal,
  onToggleObjectsExpand,
  onSelectObject,
}: RoadLayerItemProps) {
  const { t } = useTranslation();
  const roadSignals = road.signals ?? [];
  const roadObjects = road.objects ?? [];

  return (
    <div key={`road-${road.id}`} className="road-list-entry" ref={entryRef}>
      <div
        className={`layer-item ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={onSelect}
      >
        <button
          className="road-expand"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="layer-name">
          {road.name || `Road(${road.id})`}
          <span className="road-id"> ({road.id})</span>
        </span>
        <button
          className="road-zoom-btn"
          onClick={(event) => {
            event.stopPropagation();
            onZoom();
          }}
          title={t('layerPanel.zoomTo')}
        >
          <Crosshair size={12} />
        </button>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisibility();
          }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {isExpanded && (
        <div className="road-details">
          {road.lane_sections.map((laneSection, sectionIndex) => {
            const sectionKey = makeLaneSectionKey(road.id, sectionIndex);
            const sectionExpanded = laneSectionsExpanded.has(sectionKey);
            const sectionVisible = isLaneSectionVisible(sectionIndex);

            return (
              <div
                key={sectionIndex}
                className={`road-detail-lane-section ${sectionExpanded ? 'expanded' : ''}`}
              >
                <div
                  className={`layer-item layer-item-child layer-item-section ${isLaneSectionSelected(sectionIndex) ? 'selected' : ''} ${!sectionVisible ? 'layer-item-hidden' : ''}`}
                  onClick={() => onSelectLaneSection(sectionIndex)}
                >
                  <button
                    className="road-expand"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLaneSectionExpand(sectionIndex);
                    }}
                  >
                    {sectionExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <span className="layer-name">
                    {t('layerPanel.laneSection')} #{sectionIndex + 1}
                    <span className="road-id"> (s={laneSection.s.toFixed(1)})</span>
                  </span>
                  <button
                    className={`road-visibility ${sectionVisible ? '' : 'off'}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLaneSectionVisibility(sectionIndex);
                    }}
                    title={sectionVisible ? t('layerPanel.hideLaneSection') : t('layerPanel.showLaneSection')}
                  >
                    {sectionVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
                {sectionExpanded && (
                  <div className="lane-section-children">
                    {laneSection.left.map((lane) => {
                      const laneVisible = isLaneVisible(sectionIndex, 'left', lane.id);

                      return (
                        <div
                          key={`l${lane.id}`}
                          className={`layer-item layer-item-child layer-item-lane ${isLaneSelected(sectionIndex, 'left', lane.id) ? 'selected' : ''} ${!laneVisible ? 'layer-item-hidden' : ''}`}
                          onClick={() => onSelectLane(sectionIndex, 'left', lane.id)}
                        >
                          <span className="layer-name">
                            {t('layerPanel.lane')} L{Math.abs(lane.id)}
                            <span className="road-id"> ({lane.lane_type})</span>
                          </span>
                          <button
                            className={`road-visibility ${laneVisible ? '' : 'off'}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleLaneVisibility(sectionIndex, 'left', lane.id);
                            }}
                            title={laneVisible ? t('layerPanel.hideLane') : t('layerPanel.showLane')}
                          >
                            {laneVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        </div>
                      );
                    })}
                    {laneSection.right.map((lane) => {
                      const laneVisible = isLaneVisible(sectionIndex, 'right', lane.id);

                      return (
                        <div
                          key={`r${lane.id}`}
                          className={`layer-item layer-item-child layer-item-lane ${isLaneSelected(sectionIndex, 'right', lane.id) ? 'selected' : ''} ${!laneVisible ? 'layer-item-hidden' : ''}`}
                          onClick={() => onSelectLane(sectionIndex, 'right', lane.id)}
                        >
                          <span className="layer-name">
                            {t('layerPanel.lane')} R{Math.abs(lane.id)}
                            <span className="road-id"> ({lane.lane_type})</span>
                          </span>
                          <button
                            className={`road-visibility ${laneVisible ? '' : 'off'}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleLaneVisibility(sectionIndex, 'right', lane.id);
                            }}
                            title={laneVisible ? t('layerPanel.hideLane') : t('layerPanel.showLane')}
                          >
                            {laneVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {roadSignals.length > 0 && (
            <div className="road-sub-group">
              <div
                className="layer-item layer-item-child layer-item-section"
                onClick={onToggleSignalsExpand}
              >
                <button
                  className="road-expand"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSignalsExpand();
                  }}
                >
                  {signalsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <span className="layer-name">
                  {t('layerPanel.roadSignals')}
                  <span className="road-id"> ({roadSignals.length})</span>
                </span>
              </div>
              {signalsExpanded && (
                <div className="lane-section-children">
                  {roadSignals.map((signal) => {
                    const isSignalSelected = selectedSceneNode?.type === 'signal'
                      && selectedSceneNode.roadId === road.id
                      && selectedSceneNode.signalId === signal.id;
                    const displayName = signal.name
                      ? signal.name
                      : `${signal.signal_subtype || signal.signal_type} (${signal.id})`;

                    return (
                      <div
                        key={signal.id}
                        className={`layer-item layer-item-child layer-item-lane ${isSignalSelected ? 'selected' : ''}`}
                        onClick={() => onSelectSignal(signal.id)}
                      >
                        <span className="layer-name">{displayName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {roadObjects.length > 0 && (
            <div className="road-sub-group">
              <div
                className="layer-item layer-item-child layer-item-section"
                onClick={onToggleObjectsExpand}
              >
                <button
                  className="road-expand"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleObjectsExpand();
                  }}
                >
                  {objectsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <span className="layer-name">
                  {t('layerPanel.roadObjects')}
                  <span className="road-id"> ({roadObjects.length})</span>
                </span>
              </div>
              {objectsExpanded && (
                <div className="lane-section-children">
                  {roadObjects.map((object) => {
                    const isObjectSelected = selectedSceneNode?.type === 'object'
                      && selectedSceneNode.roadId === road.id
                      && selectedSceneNode.objectId === object.id;
                    const typeStr = typeof object.object_type === 'string'
                      ? object.object_type
                      : object.object_type.Custom;
                    const displayName = object.name
                      ? object.name
                      : `${typeStr} (${object.id})`;

                    return (
                      <div
                        key={object.id}
                        className={`layer-item layer-item-child layer-item-lane ${isObjectSelected ? 'selected' : ''}`}
                        onClick={() => onSelectObject(object.id)}
                      >
                        <span className="layer-name">
                          {displayName}
                          {object.name && <span className="road-id"> ({typeStr})</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
