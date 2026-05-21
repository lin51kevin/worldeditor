import { useTranslation } from 'react-i18next';
import { RoadEditToolbar } from '../shell/RoadEditToolbar';
import { resolveIcon } from '../shared/IconRenderer';
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
  { icon: 'Diamond', labelKey: 'toolPanel.autoCreateJunction', disabled: true },
  { icon: 'PanelTop', labelKey: 'toolPanel.autoCreateSignBoard', disabled: true },
  { icon: 'Link2', labelKey: 'toolPanel.autoCreateContinuousRoad', disabled: true },
  { icon: 'TrafficCone', labelKey: 'toolPanel.autoCreateTrafficSignal', disabled: true },
  { icon: 'ArrowLeftRight', labelKey: 'toolPanel.swapRoadDirection', disabled: true },
];

export function ToolPanel() {
  const { t } = useTranslation();

  return (
    <div className="tool-panel">
      <div className="tool-header">{t('toolPanel.header')}</div>
      <div className="tool-section-header">- {t('toolPanel.calculateRoadLength')}</div>
      <div className="tool-row">
        <span className="tool-label">{t('toolPanel.roadLengthLabel')}</span>
        <input className="tool-input" type="text" value="0.00000" readOnly />
      </div>
      <div className="tool-list">
        {TOOLS.map((tool, i) => (
          <button
            key={i}
            className={`tool-item ${tool.disabled ? 'disabled' : ''}`}
            onClick={tool.action}
            disabled={tool.disabled}
            title={t(tool.labelKey)}
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
