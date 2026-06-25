import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff, GitMerge } from 'lucide-react';
import { useProjectStore } from '../../../stores/projectStore';
import { useViewportStore } from '../../../stores/viewportStore';
import { makeLaneKey, makeLaneSectionKey } from '../../../utils/sceneGraph';
import { emitViewportEvent } from '../../../viewport/viewportEvents';
import type { FlatLayerItem } from './virtualLayerTypes';

interface VirtualRowProps {
  item: FlatLayerItem;
  expandedRoads: Set<string>;
  expandedLaneSections: Set<string>;
  expandedRoadSignals: Set<string>;
  expandedRoadObjects: Set<string>;
  onToggleRoadExpand: (roadId: string) => void;
  onToggleLaneSectionExpand: (sectionKey: string) => void;
  onEnsureLaneSectionExpand: (sectionKey: string) => void;
  onToggleRoadSignalsExpand: (roadId: string) => void;
  onToggleRoadObjectsExpand: (roadId: string) => void;
  onSelectionFromPanel: () => void;
}

/** Road row — self-subscribes to selection and visibility */
const RoadRow = memo(function RoadRow({
  roadId,
  isExpanded,
  onToggleExpand,
  onSelectionFromPanel,
}: {
  roadId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelectionFromPanel: () => void;
}) {
  const { t } = useTranslation();
  const road = useProjectStore(useCallback(
    (s) => s.project.roads.find((r) => r.id === roadId),
    [roadId],
  ));
  const isSelected = useProjectStore(useCallback(
    (s) => (s.selectedSceneNode?.type === 'road' && s.selectedSceneNode.roadId === roadId)
      || s.selectedRoadIds.includes(roadId),
    [roadId],
  ));
  const isVisible = useViewportStore(useCallback(
    (s) => !s.display.hiddenRoadIds.includes(roadId),
    [roadId],
  ));

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    useProjectStore.getState().selectRoad(roadId);
  }, [roadId, onSelectionFromPanel]);

  const handleZoom = useCallback(() => {
    handleSelect();
    emitViewportEvent({ type: 'zoom-to-selected', roadId });
  }, [roadId, handleSelect]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleRoadVisibility(roadId);
  }, [roadId]);

  if (!road) return null;
  const roadName = road.name || `Road(${road.id})`;

  return (
    <div className="road-list-entry">
      <div
        className={`layer-item ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <button
          className="road-expand"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="layer-name">
          {roadName}
          <span className="road-id"> ({road.id})</span>
        </span>
        <button
          className="road-zoom-btn"
          onClick={(e) => { e.stopPropagation(); handleZoom(); }}
          title={t('layerPanel.zoomTo')}
        >
          <Crosshair size={12} />
        </button>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/** Lane section row */
const LaneSectionRow = memo(function LaneSectionRow({
  roadId,
  sectionIndex,
  isExpanded,
  onToggleExpand,
  onEnsureExpand,
  onSelectionFromPanel,
}: {
  roadId: string;
  sectionIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEnsureExpand: () => void;
  onSelectionFromPanel: () => void;
}) {
  const { t } = useTranslation();
  const sValue = useProjectStore(useCallback(
    (s) => s.project.roads.find((r) => r.id === roadId)?.lane_sections[sectionIndex]?.s,
    [roadId, sectionIndex],
  ));
  const isSelected = useProjectStore(useCallback(
    (s) => s.selectedSceneNode?.type === 'laneSection'
      && s.selectedSceneNode.roadId === roadId
      && s.selectedSceneNode.sectionIndex === sectionIndex,
    [roadId, sectionIndex],
  ));
  const sectionKey = makeLaneSectionKey(roadId, sectionIndex);
  const isVisible = useViewportStore(useCallback(
    (s) => !s.display.hiddenRoadIds.includes(roadId)
      && !s.display.hiddenLaneSectionKeys.includes(sectionKey),
    [roadId, sectionKey],
  ));

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    onEnsureExpand();
    useProjectStore.getState().selectLaneSection(roadId, sectionIndex);
  }, [roadId, sectionIndex, onSelectionFromPanel, onEnsureExpand]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleLaneSectionVisibility(sectionKey);
  }, [sectionKey]);

  return (
    <div>
      <div
        className={`layer-item layer-item-child layer-item-section ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <button
          className="road-expand"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="layer-name">
          {t('layerPanel.laneSection')} #{sectionIndex + 1}
          <span className="road-id"> (s={sValue?.toFixed(1) ?? '?'})</span>
        </span>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideLaneSection') : t('layerPanel.showLaneSection')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/** Lane row */
const LaneRow = memo(function LaneRow({
  roadId,
  sectionIndex,
  side,
  laneId,
  laneType,
  onSelectionFromPanel,
}: {
  roadId: string;
  sectionIndex: number;
  side: 'left' | 'right';
  laneId: number;
  laneType: string;
  onSelectionFromPanel: () => void;
}) {
  const { t } = useTranslation();
  const isSelected = useProjectStore(useCallback(
    (s) => s.selectedSceneNode?.type === 'lane'
      && s.selectedSceneNode.roadId === roadId
      && s.selectedSceneNode.sectionIndex === sectionIndex
      && s.selectedSceneNode.side === side
      && s.selectedSceneNode.laneId === laneId,
    [roadId, sectionIndex, side, laneId],
  ));
  const laneKey = makeLaneKey(roadId, sectionIndex, side, laneId);
  const sectionKey = makeLaneSectionKey(roadId, sectionIndex);
  const isVisible = useViewportStore(useCallback(
    (s) => !s.display.hiddenRoadIds.includes(roadId)
      && !s.display.hiddenLaneSectionKeys.includes(sectionKey)
      && !s.display.hiddenLaneKeys.includes(laneKey),
    [roadId, sectionKey, laneKey],
  ));

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    useProjectStore.getState().selectLane(roadId, sectionIndex, side, laneId);
  }, [roadId, sectionIndex, side, laneId, onSelectionFromPanel]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleLaneVisibility(roadId, sectionIndex, side, laneId);
  }, [roadId, sectionIndex, side, laneId]);

  const prefix = side === 'left' ? 'L' : 'R';

  return (
    <div>
      <div
        className={`layer-item layer-item-child layer-item-lane ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <span className="layer-name">
          {t('layerPanel.lane')} {prefix}{Math.abs(laneId)}
          <span className="type-tag" data-type={laneType}>{laneType}</span>
        </span>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideLane') : t('layerPanel.showLane')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/** Signal group header row */
const SignalGroupRow = memo(function SignalGroupRow({
  count,
  isExpanded,
  onToggleExpand,
}: {
  roadId: string;
  count: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="layer-item layer-item-child layer-item-section" onClick={onToggleExpand}>
        <button
          className="road-expand"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="layer-name">
          {t('layerPanel.roadSignals')}
          <span className="road-id"> ({count})</span>
        </span>
      </div>
    </div>
  );
});

/** Signal row */
const SignalRow = memo(function SignalRow({
  roadId,
  signalId,
  signalName,
  signalType,
  onSelectionFromPanel,
}: {
  roadId: string;
  signalId: string;
  signalName: string;
  signalType: string;
  onSelectionFromPanel: () => void;
}) {
  const isSelected = useProjectStore(useCallback(
    (s) => s.selectedSceneNode?.type === 'signal'
      && s.selectedSceneNode.roadId === roadId
      && s.selectedSceneNode.signalId === signalId,
    [roadId, signalId],
  ));
  const signalKey = `${roadId}::signal::${signalId}`;
  const isVisible = useViewportStore(useCallback(
    (s) => !(s.display.hiddenSignalKeys ?? []).includes(signalKey),
    [signalKey],
  ));
  const { t } = useTranslation();

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    useProjectStore.getState().selectSignal(roadId, signalId);
  }, [roadId, signalId, onSelectionFromPanel]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleSignalVisibility(roadId, signalId);
  }, [roadId, signalId]);

  const sigLabel = signalName ? `${signalName} (${signalId})` : `(${signalId})`;

  return (
    <div>
      <div
        className={`layer-item layer-item-child layer-item-lane ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <span className="layer-name" title={`${sigLabel} (${signalType})`}>
          {sigLabel}
          <span className="type-tag" data-type="signal">{signalType}</span>
        </span>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/** Object group header row */
const ObjectGroupRow = memo(function ObjectGroupRow({
  count,
  isExpanded,
  onToggleExpand,
}: {
  roadId: string;
  count: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="layer-item layer-item-child layer-item-section" onClick={onToggleExpand}>
        <button
          className="road-expand"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="layer-name">
          {t('layerPanel.roadObjects')}
          <span className="road-id"> ({count})</span>
        </span>
      </div>
    </div>
  );
});

/** Object row */
const ObjectRow = memo(function ObjectRow({
  roadId,
  objectId,
  objectName,
  objectType,
  onSelectionFromPanel,
}: {
  roadId: string;
  objectId: string;
  objectName: string;
  objectType: string;
  onSelectionFromPanel: () => void;
}) {
  const isSelected = useProjectStore(useCallback(
    (s) => s.selectedSceneNode?.type === 'object'
      && s.selectedSceneNode.roadId === roadId
      && s.selectedSceneNode.objectId === objectId,
    [roadId, objectId],
  ));
  const objectKey = `${roadId}::object::${objectId}`;
  const isVisible = useViewportStore(useCallback(
    (s) => !(s.display.hiddenObjectKeys ?? []).includes(objectKey),
    [objectKey],
  ));
  const { t } = useTranslation();

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    useProjectStore.getState().selectObject(roadId, objectId);
  }, [roadId, objectId, onSelectionFromPanel]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleObjectVisibility(roadId, objectId);
  }, [roadId, objectId]);

  const objLabel = objectName ? `${objectName} (${objectId})` : `(${objectId})`;

  return (
    <div>
      <div
        className={`layer-item layer-item-child layer-item-lane ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <span className="layer-name" title={`${objLabel} (${objectType})`}>
          {objLabel}
          <span className="type-tag" data-type={objectType}>{objectType}</span>
        </span>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/** Junction row */
const JunctionRow = memo(function JunctionRow({
  junctionId,
  onSelectionFromPanel,
}: {
  junctionId: string;
  onSelectionFromPanel: () => void;
}) {
  const { t } = useTranslation();
  const junction = useProjectStore(useCallback(
    (s) => s.project.junctions.find((j) => j.id === junctionId),
    [junctionId],
  ));
  const isSelected = useProjectStore(useCallback(
    (s) => s.selectedJunctionId === junctionId || s.selectedJunctionIds.includes(junctionId),
    [junctionId],
  ));
  const isVisible = useViewportStore(useCallback(
    (s) => !s.display.hiddenJunctionIds.includes(junctionId),
    [junctionId],
  ));

  const handleSelect = useCallback(() => {
    onSelectionFromPanel();
    useProjectStore.getState().selectJunction(junctionId);
  }, [junctionId, onSelectionFromPanel]);

  const handleZoom = useCallback(() => {
    handleSelect();
    emitViewportEvent({ type: 'zoom-to-junction', junctionId });
  }, [junctionId, handleSelect]);

  const handleToggleVisibility = useCallback(() => {
    useViewportStore.getState().toggleJunctionVisibility(junctionId);
  }, [junctionId]);

  if (!junction) return null;

  return (
    <div className="road-list-entry">
      <div
        className={`layer-item ${isSelected ? 'selected' : ''} ${!isVisible ? 'layer-item-hidden' : ''}`}
        onClick={handleSelect}
      >
        <span className="road-expand road-expand-placeholder" />
        <GitMerge size={12} className="junction-icon" />
        <span className="layer-name">
          {junction.name || `Junction(${junction.id})`}
          <span className="road-id"> ({junction.id})</span>
        </span>
        <button
          className="road-zoom-btn"
          onClick={(e) => { e.stopPropagation(); handleZoom(); }}
          title={t('layerPanel.zoomTo')}
        >
          <Crosshair size={12} />
        </button>
        <button
          className={`road-visibility ${isVisible ? '' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(); }}
          title={isVisible ? t('layerPanel.hideRoad') : t('layerPanel.showRoad')}
        >
          {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
});

/**
 * Renders a single row based on the FlatLayerItem type.
 * Uses self-subscribing child components so that selection/visibility changes
 * only re-render the affected row(s).
 */
export const VirtualLayerRow = memo(function VirtualLayerRow({
  item,
  expandedRoads,
  expandedLaneSections,
  expandedRoadSignals,
  expandedRoadObjects,
  onToggleRoadExpand,
  onToggleLaneSectionExpand,
  onEnsureLaneSectionExpand,
  onToggleRoadSignalsExpand,
  onToggleRoadObjectsExpand,
  onSelectionFromPanel,
}: VirtualRowProps) {
  switch (item.type) {
    case 'road':
      return (
        <RoadRow
          roadId={item.roadId}
          isExpanded={expandedRoads.has(item.roadId)}
          onToggleExpand={() => onToggleRoadExpand(item.roadId)}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );

    case 'laneSection':
      return (
        <LaneSectionRow
          roadId={item.roadId}
          sectionIndex={item.sectionIndex}
          isExpanded={expandedLaneSections.has(makeLaneSectionKey(item.roadId, item.sectionIndex))}
          onToggleExpand={() => onToggleLaneSectionExpand(makeLaneSectionKey(item.roadId, item.sectionIndex))}
          onEnsureExpand={() => onEnsureLaneSectionExpand(makeLaneSectionKey(item.roadId, item.sectionIndex))}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );

    case 'lane':
      return (
        <LaneRow
          roadId={item.roadId}
          sectionIndex={item.sectionIndex}
          side={item.side}
          laneId={item.laneId}
          laneType={item.laneType}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );

    case 'signalGroup':
      return (
        <SignalGroupRow
          roadId={item.roadId}
          count={item.count}
          isExpanded={expandedRoadSignals.has(item.roadId)}
          onToggleExpand={() => onToggleRoadSignalsExpand(item.roadId)}
        />
      );

    case 'signal':
      return (
        <SignalRow
          roadId={item.roadId}
          signalId={item.signalId}
          signalName={item.signalName}
          signalType={item.signalType}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );

    case 'objectGroup':
      return (
        <ObjectGroupRow
          roadId={item.roadId}
          count={item.count}
          isExpanded={expandedRoadObjects.has(item.roadId)}
          onToggleExpand={() => onToggleRoadObjectsExpand(item.roadId)}
        />
      );

    case 'object':
      return (
        <ObjectRow
          roadId={item.roadId}
          objectId={item.objectId}
          objectName={item.objectName}
          objectType={item.objectType}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );

    case 'junction':
      return (
        <JunctionRow
          junctionId={item.junctionId}
          onSelectionFromPanel={onSelectionFromPanel}
        />
      );
  }
});
