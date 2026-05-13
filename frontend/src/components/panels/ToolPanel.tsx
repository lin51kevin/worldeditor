import { useTranslation } from 'react-i18next';
import { RoadEditToolbar } from '../shell/RoadEditToolbar';
import './ToolPanel.css';

interface ToolItem {
  icon: string;
  labelKey: string;
  action?: () => void;
  disabled?: boolean;
}

const TOOLS: ToolItem[] = [
  { icon: '📏', labelKey: 'toolPanel.calculateRoadLength' },
  { icon: '🚶', labelKey: 'toolPanel.createPedestrian', disabled: true },
  { icon: '🔦', labelKey: 'toolPanel.autoCreateStreetLight', disabled: true },
  { icon: '🗑', labelKey: 'toolPanel.autoCreateTrashBin', disabled: true },
  { icon: '✂', labelKey: 'toolPanel.autoSplitOverlapping', disabled: true },
  { icon: '◇', labelKey: 'toolPanel.autoCreateJunction', disabled: true },
  { icon: '🪧', labelKey: 'toolPanel.autoCreateSignBoard', disabled: true },
  { icon: '🔗', labelKey: 'toolPanel.autoCreateContinuousRoad', disabled: true },
  { icon: '🚦', labelKey: 'toolPanel.autoCreateTrafficSignal', disabled: true },
  { icon: '↔', labelKey: 'toolPanel.swapRoadDirection', disabled: true },
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
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-name">{t(tool.labelKey)}</span>
          </button>
        ))}
      </div>
      <RoadEditToolbar />
    </div>
  );
}
