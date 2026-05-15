import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff } from 'lucide-react';
import { useCallback } from 'react';
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
  onToggleSignalVisibility: (signalId: string) => void;
  isSignalVisible: (signalId: string) => boolean;
  registerSignalRef?: (signalId: string, el: HTMLDivElement | null) => void;
  onToggleObjectsExpand: () => void;
  onSelectObject: (objectId: string) => void;
  onToggleObjectVisibility: (objectId: string) => void;
  isObjectVisible: (objectId: string) => boolean;
  registerObjectRef?: (objectId: string, el: HTMLDivElement | null) => void;
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
  onToggleSignalVisibility,
  isSignalVisible,
  registerSignalRef,
  onToggleObjectsExpand,
  onSelectObject,
  onToggleObjectVisibility,
  isObjectVisible,
  registerObjectRef,
}: RoadLayerItemProps) {
  const { t } = useTranslation();
  const roadSignals = road.signals ?? [];
  const roadObjects = road.objects ?? [];
  const getObjTypeStr = useCallback(
    (obj: (typeof roadObjects)[number]) =>
      typeof obj.object_type === 'string' ? obj.object_type : obj.object_type.Custom,
    [],
  );

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
                            <span className="type-tag" data-type={lane.lane_type}>{lane.lane_type}</span>
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
                            <span className="type-tag" data-type={lane.lane_type}>{lane.lane_type}</span>
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
                    const sigType = signal.signal_subtype || signal.signal_type;
                    const sigLabel = signal.name
                      ? `${signal.name} (${signal.id})`
                      : `(${signal.id})`;
                    const displayName = `${sigLabel} (${sigType})`;

                    return (
                      <div
                        key={signal.id}
                        ref={(el) => registerSignalRef?.(signal.id, el)}
                        className={`layer-item layer-item-child layer-item-lane ${isSignalSelected ? 'selected' : ''} ${!isSignalVisible(signal.id) ? 'layer-item-hidden' : ''}`}
                        onClick={() => onSelectSignal(signal.id)}
                      >
                        <span className="layer-name" title={displayName}>
                          {sigLabel}
                          <span className="type-tag" data-type="signal">{sigType}</span>
                        </span>
                        <button
                          className={`road-visibility ${isSignalVisible(signal.id) ? '' : 'off'}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleSignalVisibility(signal.id);
                          }}
                          title={isSignalVisible(signal.id) ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
                        >
                          {isSignalVisible(signal.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
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
                    const typeStr = getObjTypeStr(object);
                    const objLabel = object.name
                      ? `${object.name} (${object.id})`
                      : `(${object.id})`;
                    const displayName = `${objLabel} (${typeStr})`;
                    return (
                      <div
                        key={object.id}
                        ref={(el) => registerObjectRef?.(object.id, el)}
                        className={`layer-item layer-item-child layer-item-lane ${isObjectSelected ? 'selected' : ''} ${!isObjectVisible(object.id) ? 'layer-item-hidden' : ''}`}
                        onClick={() => onSelectObject(object.id)}
                      >
                        <span className="layer-name" title={displayName}>
                          {objLabel}
                          <span className="type-tag" data-type={typeStr}>{typeStr}</span>
                        </span>
                        <button
                          className={`road-visibility ${isObjectVisible(object.id) ? '' : 'off'}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleObjectVisibility(object.id);
                          }}
                          title={isObjectVisible(object.id) ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
                        >
                          {isObjectVisible(object.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
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
