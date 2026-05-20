import { useState, useCallback } from 'react';
import { Eye, EyeOff, Save, X, Plug, Check, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_PRESETS, getPreset } from '../providers/provider-registry';
import type { CopilotConfig } from '../core/config-store';
import { saveConfig } from '../core/config-store';
import { getIntentsConfigPathHint } from '../core/intent-parser';
import type { AIProviderConfig } from '../providers/types';
import { OpenAICompatibleProvider } from '../providers/openai-compatible';
import { ModelCombobox } from './ModelCombobox';
import './CopilotPanel.css';

interface SettingsViewProps {
  config: CopilotConfig;
  onSave: (config: CopilotConfig) => void;
  onClose: () => void;
}

export function SettingsView({ config: initialConfig, onSave, onClose }: SettingsViewProps) {
  const { t } = useTranslation();
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
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const preset = getPreset(activeProviderId);

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
      setTestResult(null);
      setTestError(null);
    },
    [initialConfig.providers]
  );

  const handleTestConnection = useCallback(async () => {
    const url = baseUrl.trim();
    if (!url) {
      setTestResult(false);
      setTestError(t('copilot.settingsInvalidConfig'));
      return;
    }

    setTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const providerCfg: AIProviderConfig = {
        id: activeProviderId,
        name: preset?.name ?? 'Custom',
        baseUrl: url,
        apiKey,
        model,
      };
      const provider = new OpenAICompatibleProvider(providerCfg);
      const ok = await provider.healthCheck();
      setTestResult(ok);
      if (!ok) {
        setTestError(t('copilot.settingsFailed'));
      }
    } catch (err) {
      setTestResult(false);
      if (err instanceof Error && err.message === 'network_error') {
        setTestError(t('copilot.settingsCorsHint') || 'Connection failed (CORS?). For Ollama, add --cors when starting.');
      } else {
        setTestError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setTesting(false);
    }
  }, [baseUrl, apiKey, model, activeProviderId, preset, t]);

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
    };

    saveConfig(updated);
    onSave(updated);
  }, [activeProviderId, baseUrl, apiKey, model, initialConfig, onSave]);

  const isCloud = preset ? preset.type === 'cloud' : true;

  return (
    <div className="copilot-settings">
      {/* Header */}
      <div className="copilot-settings-header">
        <span>{t('copilot.settingsTitle')}</span>
        <button className="copilot-settings-close-btn" onClick={onClose} aria-label={t('copilot.settingsClose')}>
          <X size={14} />
        </button>
      </div>

      <div className="copilot-settings-desc">
        Intent config is loaded from the bundled default and can be overridden at
        <code> {getIntentsConfigPathHint()}</code> in the user config directory.
      </div>

      {/* Provider input with datalist */}
      <div className="copilot-settings-field">
        <label>{t('copilot.settingsProvider')}</label>
        <input
          type="text"
          list="copilot-provider-list"
          value={activeProviderId}
          onChange={(e) => handleProviderChange(e.target.value)}
          placeholder={t('copilot.settingsProviderHint')}
        />
        <datalist id="copilot-provider-list">
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </datalist>
        {/* Provider description */}
        {preset?.description && (
          <div className="copilot-settings-desc">
            {preset.name} — {preset.description}
          </div>
        )}
      </div>

      {/* Provider config section */}
      <div className="copilot-settings-section">
        {/* API Key — only for cloud providers */}
        {isCloud && (
          <div className="copilot-settings-field">
            <div className="copilot-settings-label-row">
              <label>{t('copilot.settingsApiKey')}</label>
              {preset?.apiKeyUrl && (
                <a
                  href={preset.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="copilot-settings-link"
                >
                  {t('copilot.settingsGetApiKey')}
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="copilot-settings-password-wrap">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                placeholder={preset?.apiKeyPlaceholder ?? t('copilot.settingsApiKeyPlaceholder')}
              />
              <button
                className="copilot-settings-toggle-pw"
                onClick={() => setShowApiKey(!showApiKey)}
                type="button"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Base URL */}
        <div className="copilot-settings-field">
          <label>{t('copilot.settingsApiUrl')}</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
            placeholder={preset?.baseUrl || 'https://api.example.com/v1'}
          />
        </div>

        {/* Model — custom combobox with search, paste, and fetch */}
        <div className="copilot-settings-field">
          <label>{t('copilot.settingsModel')}</label>
          <ModelCombobox
            value={model}
            onChange={setModel}
            presetModels={preset?.models ?? []}
            placeholder={preset?.defaultModel || t('copilot.settingsModelPlaceholder')}
            onFetchModels={async () => {
              const providerCfg: AIProviderConfig = {
                id: activeProviderId,
                name: preset?.name ?? 'Custom',
                baseUrl: baseUrl.trim(),
                apiKey,
                model,
              };
              const provider = new OpenAICompatibleProvider(providerCfg);
              const models = await provider.listModels();
              return models.map((m) => m.id);
            }}
          />
        </div>

        {/* Test connection */}
        <div className="copilot-settings-test-row">
          <button
            className="copilot-settings-test-btn"
            onClick={handleTestConnection}
            disabled={testing}
            data-testid="test-connection-btn"
          >
            <Plug size={12} />
            {testing ? t('copilot.settingsTesting') : t('copilot.settingsTestConnection')}
          </button>
          {testResult !== null && (
            <span className={`copilot-settings-test-status ${testResult ? 'copilot-settings-test-status--ok' : 'copilot-settings-test-status--fail'}`}>
              {testResult ? <Check size={12} /> : <X size={12} />}
              {testResult ? t('copilot.settingsConnected') : t('copilot.settingsFailed')}
            </span>
          )}
          {testError && !testResult && (
            <span className="copilot-settings-test-error" title={testError}>
              {testError}
            </span>
          )}
        </div>
      </div>

      {/* Footer: Cancel + Save */}
      <div className="copilot-settings-footer">
        <button className="copilot-settings-cancel-btn" onClick={onClose}>
          {t('copilot.settingsCancel')}
        </button>
        <button className="copilot-settings-save-btn" onClick={handleSave}>
          <Save size={12} />
          {t('copilot.settingsSave')}
        </button>
      </div>
    </div>
  );
}
