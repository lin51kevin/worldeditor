import { useState, useCallback } from 'react';
import { Eye, EyeOff, Save, X } from 'lucide-react';
import { PROVIDER_PRESETS, getPreset } from '../providers/provider-registry';
import type { CopilotConfig } from '../core/config-store';
import { saveConfig } from '../core/config-store';
import type { AIProviderConfig } from '../providers/types';
import './CopilotPanel.css';

interface SettingsViewProps {
  config: CopilotConfig;
  onSave: (config: CopilotConfig) => void;
  onClose: () => void;
}

export function SettingsView({ config: initialConfig, onSave, onClose }: SettingsViewProps) {
  const [activeProviderId, setActiveProviderId] = useState(initialConfig.activeProviderId);
  const [baseUrl, setBaseUrl] = useState(
    initialConfig.providers[initialConfig.activeProviderId]?.baseUrl ?? ''
  );
  const [apiKey, setApiKey] = useState(
    initialConfig.providers[initialConfig.activeProviderId]?.apiKey ?? ''
  );
  const [model, setModel] = useState(
    initialConfig.providers[initialConfig.activeProviderId]?.model ?? ''
  );
  const [applyMode, setApplyMode] = useState(initialConfig.applyMode);
  const [showApiKey, setShowApiKey] = useState(false);

  const preset = getPreset(activeProviderId);
  const models = preset?.models ?? [];

  const handleProviderChange = useCallback(
    (newId: string) => {
      setActiveProviderId(newId);
      const p = getPreset(newId);
      if (p) {
        setBaseUrl(p.baseUrl);
        setModel(p.defaultModel);
        setApiKey(initialConfig.providers[newId]?.apiKey ?? '');
      } else {
        setBaseUrl('');
        setModel('');
        setApiKey('');
      }
    },
    [initialConfig.providers]
  );

  const handleSave = useCallback(() => {
    const providerConfig: AIProviderConfig = {
      id: activeProviderId,
      name: getPreset(activeProviderId)?.name ?? 'Custom',
      baseUrl,
      apiKey,
      model,
    };

    const updated: CopilotConfig = {
      ...initialConfig,
      activeProviderId,
      providers: {
        ...initialConfig.providers,
        [activeProviderId]: providerConfig,
      },
      applyMode,
    };

    saveConfig(updated);
    onSave(updated);
  }, [activeProviderId, baseUrl, apiKey, model, applyMode, initialConfig, onSave]);

  return (
    <div className="copilot-settings">
      <div className="copilot-settings-header">
        <span>⚙️ AI 助手设置</span>
        <button className="copilot-settings-close-btn" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </div>

      <div className="copilot-settings-field">
        <label>AI Provider</label>
        <select
          value={activeProviderId}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="copilot-settings-field">
        <label>API 地址</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>

      <div className="copilot-settings-field">
        <label>API Key</label>
        <div className="copilot-settings-password-wrap">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="(可选)"
          />
          <button
            className="copilot-settings-toggle-pw"
            onClick={() => setShowApiKey(!showApiKey)}
            type="button"
            tabIndex={-1}
          >
            {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="copilot-settings-field">
        <label>模型</label>
        {models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="输入模型名称"
          />
        )}
      </div>

      <div className="copilot-settings-field">
        <label>应用模式</label>
        <div className="copilot-settings-radios">
          <label className="copilot-settings-radio">
            <input
              type="radio"
              name="applyMode"
              value="manual"
              checked={applyMode === 'manual'}
              onChange={() => setApplyMode('manual')}
            />
            手动确认 (推荐)
          </label>
          <label className="copilot-settings-radio">
            <input
              type="radio"
              name="applyMode"
              value="auto"
              checked={applyMode === 'auto'}
              onChange={() => setApplyMode('auto')}
            />
            自动执行
          </label>
        </div>
      </div>

      <button className="copilot-settings-save-btn" onClick={handleSave}>
        <Save size={16} />
        保存设置
      </button>
    </div>
  );
}
