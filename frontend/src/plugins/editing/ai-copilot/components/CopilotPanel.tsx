/**
 * CopilotPanel — AI assistant chat panel (with full interaction)
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Plus, ArrowUp, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopilotEngine } from '../core/copilot-engine';
import type { CopilotEngineCallbacks } from '../core/copilot-engine';
import { getQuickCommandList } from '../core/intent-parser';
import { loadConfig, saveConfig } from '../core/config-store';
import type { CopilotConfig } from '../core/config-store';
import type { ActionResult } from '../core/action-executor';
import { ChatArea } from './ChatArea';
import { type ChatMessageData } from './ChatMessage';
import { QuickCommands } from './QuickCommands';
import { RoadActionPreview } from './RoadActionPreview';
import './CopilotPanel.css';

export function CopilotPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [quickCmdFilter, setQuickCmdFilter] = useState('');
  const [commandPos, setCommandPos] = useState({ top: 0, left: 0 });
  const [config, setConfig] = useState<CopilotConfig>(() => loadConfig());

  const engineRef = useRef<CopilotEngine | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    engineRef.current = new CopilotEngine();
  }, []);

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
      if (inputRef.current && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        const inputRect = inputRef.current.getBoundingClientRect();
        setCommandPos({
          top: inputRect.top - panelRect.top - 200,
          left: inputRect.left - panelRect.left,
        });
      }
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

  const handleToggleApplyMode = useCallback(() => {
    const next = config.applyMode === 'auto' ? 'manual' : 'auto';
    const newConfig: CopilotConfig = { ...config, applyMode: next };
    setConfig(newConfig);
    saveConfig(newConfig);
  }, [config]);

  const commands = getQuickCommandList();
  const activeProvider = config.providers[config.activeProviderId];
  const isAuto = config.applyMode === 'auto';
  const tipCommand = commands[0]?.command ?? '/road add';

  return (
    <div ref={panelRef} className="copilot-panel">
      {/* Title bar */}
      <div className="copilot-header">
        <span className="copilot-title">{t('copilot.title')}</span>
        <div className="copilot-header-actions">
          <button
            className="copilot-icon-btn"
            title={t('copilot.newChat')}
            onClick={handleClearHistory}
            aria-label={t('copilot.newChat')}
          >
            <Plus size={14} />
          </button>
          <button className="copilot-icon-btn" aria-label="Settings">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div data-testid="copilot-messages">
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
          position={commandPos}
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

          {/* Footer: provider name + apply mode badge + send/stop button */}
          <div className="copilot-input-footer">
            <div className="copilot-input-footer-left">
              <span className="copilot-provider-name">
                {activeProvider
                  ? `${activeProvider.name} (${activeProvider.model})`
                  : t('copilot.noProvider')}
              </span>
              <button
                className={`copilot-mode-badge${isAuto ? ' copilot-mode-badge--auto' : ''}`}
                onClick={handleToggleApplyMode}
                title={isAuto ? t('copilot.applyModeAutoTooltip') : t('copilot.applyModeManualTooltip')}
              >
                {isAuto ? t('copilot.applyModeAuto') : t('copilot.applyModeManual')}
              </button>
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
    </div>
  );
}
