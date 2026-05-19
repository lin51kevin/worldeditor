import type { AIProviderConfig } from '../providers/types';
import type { ApplyMode } from './types';

export interface CopilotConfig {
  activeProviderId: string;
  providers: Record<string, AIProviderConfig>;
  applyMode: ApplyMode;
  maxHistoryLength: number;
}

const STORAGE_KEY = 'worldeditor-copilot-config';

export function getDefaultConfig(): CopilotConfig {
  return {
    activeProviderId: 'ollama',
    providers: {
      ollama: {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
      },
    },
    applyMode: 'manual',
    maxHistoryLength: 50,
  };
}

export function loadConfig(): CopilotConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    return JSON.parse(raw) as CopilotConfig;
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(config: CopilotConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
