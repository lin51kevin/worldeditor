import { useTranslation } from 'react-i18next';
import { RoadEditToolbar } from '../shell/RoadEditToolbar';
import { resolveIcon } from '../shared/IconRenderer';
import { SignalPalette } from './SignalPalette';
import { useProjectStore } from '../../stores/projectStore';
import { useViewportStore } from '../../stores/viewportStore';
import {
  COMMON_SIGNAL_TYPES,
  DEFAULT_OBJECT_PLACEMENT,
  startObjectPlacement,
  startSignalPlacement,
} from '../../hooks/useSignalPlacement';
import { autoCreateJunction } from '../../plugins/editing/advanced-editing/commands';
import './ToolPanel.css';

interface ToolItem {
  icon: string;
  labelKey: string;
  action?: () => void;
  disabled?: boolean;
}

const TOOLS: ToolItem[] = [
  { icon: 'Ruler', labelKey: 'toolPanel.calculateRoadLength' },
  { icon: 'Footprints', labelKey: 'toolPanel.createPedestrian', disabled: true },
  { icon: 'TrafficCone', labelKey: 'toolPanel.autoCreateStreetLight', disabled: true },
  { icon: 'Trash2', labelKey: 'toolPanel.autoCreateTrashBin', disabled: true },
  { icon: 'Scissors', labelKey: 'toolPanel.autoSplitOverlapping', disabled: true },
  { icon: 'Diamond', labelKey: 'toolPanel.autoCreateJunction', action: autoCreateJunction },
  { icon: 'PanelTop', labelKey: 'toolPanel.autoCreateSignBoard', disabled: true },
  { icon: 'Link2', labelKey: 'toolPanel.autoCreateContinuousRoad', disabled: true },
  { icon: 'TrafficCone', labelKey: 'toolPanel.autoCreateTrafficSignal', disabled: true },
  { icon: 'ArrowLeftRight', labelKey: 'toolPanel.swapRoadDirection', disabled: true },
];

export function ToolPanel() {
  const { t } = useTranslation();
  const roadCount = useProjectStore((state) => state.project.roads.length);
  const editMode = useViewportStore((state) => state.editMode);
  const signalPlacementDraft = useViewportStore((state) => state.signalPlacementDraft);
  const objectPlacementDraft = useViewportStore((state) => state.objectPlacementDraft);
  const setEditMode = useViewportStore((state) => state.setEditMode);

  const placementDisabled = roadCount === 0;
  const signalLabel = t(
    COMMON_SIGNAL_TYPES.find((option) => option.type === signalPlacementDraft.type)?.labelKey ?? 'signalPalette.custom',
    signalPlacementDraft.type,
  );

  const handlePlaceSignal = () => {
    if (editMode === 'placeSignal') {
      setEditMode('default');
      return;
    }
    startSignalPlacement(signalPlacementDraft);
  };

  const handlePlaceObject = () => {
    if (editMode === 'placeObject') {
      setEditMode('default');
      return;
    }
    startObjectPlacement(objectPlacementDraft);
  };

  return (
    <div className="tool-panel">
      <div className="tool-header">{t('toolPanel.header')}</div>
      <div className="tool-section-header">- {t('toolPanel.calculateRoadLength')}</div>
      <div className="tool-row">
        <span className="tool-label">{t('toolPanel.roadLengthLabel')}</span>
        <input className="tool-input" type="text" value="0.00000" readOnly />
      </div>
      <div className="tool-row tool-row--actions">
        <button
          type="button"
          className={`tool-item tool-item--compact${editMode === 'placeSignal' ? ' tool-item--active' : ''}`}
          onClick={handlePlaceSignal}
          disabled={placementDisabled}
          title={t('toolPanel.placeSignal')}
        >
          <span className="tool-icon">{resolveIcon('PanelTop')}</span>
          <span className="tool-name">{t('toolPanel.placeSignal')}</span>
        </button>
        <button
          type="button"
          className={`tool-item tool-item--compact${editMode === 'placeObject' ? ' tool-item--active' : ''}`}
          onClick={handlePlaceObject}
          disabled={placementDisabled}
          title={t('toolPanel.placeObject')}
        >
          <span className="tool-icon">{resolveIcon('TrafficCone')}</span>
          <span className="tool-name">{t('toolPanel.placeObject')}</span>
        </button>
      </div>
      <div className="tool-placement-hint">
        {editMode === 'placeObject'
          ? t('toolPanel.objectPlacementHint', { type: t(DEFAULT_OBJECT_PLACEMENT.labelKey) })
          : editMode === 'placeSignal'
            ? t('toolPanel.signalPlacementHint', { type: signalLabel })
            : t('toolPanel.placeOnRoadHint')}
      </div>
      <SignalPalette />
      <div className="tool-list">
        {TOOLS.map((tool, i) => (
          <button
            key={i}
            className={`tool-item ${tool.disabled ? 'disabled' : ''}`}
            onClick={tool.action}
            disabled={tool.disabled}
            title={t(tool.labelKey)}
            type="button"
          >
            <span className="tool-icon">{resolveIcon(tool.icon)}</span>
            <span className="tool-name">{t(tool.labelKey)}</span>
          </button>
        ))}
      </div>
      <RoadEditToolbar />
    </div>
  );
}
