/**
 * CopilotPanel — AI assistant chat panel (with full interaction)
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Plus, ArrowUp, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopilotEngine } from '../core/copilot-engine';
import type { CopilotEngineCallbacks } from '../core/copilot-engine';
import { getQuickCommandList } from '../core/intent-parser';
import { loadConfig } from '../core/config-store';
import type { CopilotConfig } from '../core/config-store';
import type { ActionResult } from '../core/action-executor';
import { usePluginContribStore } from '../../../../stores/pluginContribStore';
import { ChatArea } from './ChatArea';
import { type ChatMessageData } from './ChatMessage';
import { QuickCommands } from './QuickCommands';
import { RoadActionPreview } from './RoadActionPreview';
import { SettingsView } from './SettingsView';
import './CopilotPanel.css';

export function CopilotPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [quickCmdFilter, setQuickCmdFilter] = useState('');
  const [config, setConfig] = useState<CopilotConfig>(() => loadConfig());

  const engineRef = useRef<CopilotEngine | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hidePanel = usePluginContribStore((s) => s.hidePanel);

  useEffect(() => {
    engineRef.current = new CopilotEngine();
  }, []);

  // Configure engine whenever config changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const providerConfig = config.providers[config.activeProviderId];
    if (providerConfig) {
      engine.configure(providerConfig);
    }
  }, [config]);

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const engine = engineRef.current;
    if (!engine) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setShowCommands(false);
    setActionResult(null);
    setIsLoading(true);

    const callbacks: CopilotEngineCallbacks = {
      onChunk: (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
          } else {
            updated.push({ role: 'assistant', content: chunk });
          }
          return updated;
        });
      },
      onAction: (result: ActionResult) => {
        setActionResult(result);
      },
      onDone: () => {
        setIsLoading(false);
      },
      onError: (error: string) => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `❌ ${error}` },
        ]);
        setIsLoading(false);
      },
    };

    try {
      await engine.handleInput(trimmed, callbacks);
    } catch {
      setIsLoading(false);
    }
  }, [isLoading, messages.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (showCommands) {
        setShowCommands(false);
      } else if (isLoading && engineRef.current) {
        engineRef.current.abort();
        setIsLoading(false);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showCommands) return;
      handleSubmit(input);
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = input.substring(0, start) + '\n' + input.substring(end);
      setInput(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });
    }
  }, [input, isLoading, showCommands, handleSubmit]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    if (value.startsWith('/') && !value.includes(' ')) {
      setShowCommands(true);
      setQuickCmdFilter(value);
    } else {
      setShowCommands(false);
    }
  }, []);

  const handleCommandSelect = useCallback((cmd: string) => {
    if (cmd === '') {
      setShowCommands(false);
      return;
    }
    setInput(cmd);
    setShowCommands(false);
    inputRef.current?.focus();
  }, []);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    setActionResult(null);
    engineRef.current?.reset();
  }, []);

  const handleSettingsSave = useCallback((newConfig: CopilotConfig) => {
    setConfig(newConfig);
    setShowSettings(false);
  }, []);

  const handleClosePanel = useCallback(() => {
    hidePanel('ai-copilot:panel');
  }, [hidePanel]);

  const commands = getQuickCommandList();
  const activeProvider = config.providers[config.activeProviderId];
  const tipCommand = commands[0]?.command ?? '/road add';

  return (
    <div ref={panelRef} className="copilot-panel">
      {/* Title bar — also acts as FloatingPanel drag handle */}
      <div className="copilot-header plugin-panel-header">
        <span className="copilot-title">AI Copilot</span>
        <div className="copilot-header-actions">
          <button
            className="copilot-icon-btn"
            title={t('copilot.newChat')}
            onClick={handleClearHistory}
            aria-label={t('copilot.newChat')}
          >
            <Plus size={14} />
          </button>
          <button
            className="copilot-icon-btn"
            title={t('copilot.settings')}
            onClick={() => setShowSettings(!showSettings)}
            aria-label={t('copilot.settings')}
          >
            <Settings size={14} />
          </button>
          <button
            className="copilot-icon-btn"
            title={t('copilot.closePanel')}
            onClick={handleClosePanel}
            aria-label={t('copilot.closePanel')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Settings view (replaces chat when open) */}
      {showSettings ? (
        <div className="copilot-settings-wrap">
          <SettingsView
            config={config}
            onSave={handleSettingsSave}
            onClose={() => setShowSettings(false)}
          />
        </div>
      ) : (
        <>
          {/* Messages area */}
          <div className="copilot-messages-container" data-testid="copilot-messages">
            <ChatArea messages={messages} isLoading={isLoading} emptyText={t('copilot.emptyHint')} />
          </div>

          {/* Action result preview */}
          {actionResult && (
            <div className="copilot-action-preview-wrap">
              <RoadActionPreview result={actionResult} />
            </div>
          )}

          {/* Input area */}
          <div className="copilot-input-area">
            {/* Slash command popup - positions relative to input-area */}
            <QuickCommands
              visible={showCommands}
              commands={commands}
              onSelect={handleCommandSelect}
              filter={quickCmdFilter}
            />

            {/* Bordered input box */}
            <div className="copilot-input-box">
              {/* Tip hint row — shown only when conversation is empty */}
              {messages.length === 0 && (
                <div className="copilot-tip-row">
                  {t('copilot.tipHint', { command: tipCommand })}
                </div>
              )}

              {/* Textarea */}
              <textarea
                ref={inputRef}
                className="copilot-textarea"
                placeholder={t('copilot.inputPlaceholder')}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                rows={2}
              />

              {/* Footer: provider name + send/stop button */}
              <div className="copilot-input-footer">
                <div className="copilot-input-footer-left">
                  <span className="copilot-provider-name">
                    {activeProvider
                      ? `${activeProvider.name} (${activeProvider.model})`
                      : t('copilot.noProvider')}
                  </span>
                </div>
                {isLoading ? (
                  <button
                    className="copilot-stop-btn"
                    onClick={() => {
                      engineRef.current?.abort();
                      setIsLoading(false);
                    }}
                    title={t('copilot.stop')}
                  >
                    <Square size={8} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="copilot-send-btn"
                    disabled={!input.trim()}
                    onClick={() => handleSubmit(input)}
                    title={t('copilot.send')}
                  >
                    <ArrowUp size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
