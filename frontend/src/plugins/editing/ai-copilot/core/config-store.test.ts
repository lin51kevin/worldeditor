import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultConfig, loadConfig, saveConfig } from './config-store';
import type { CopilotConfig } from './config-store';

// STORAGE_KEY = 'worldeditor-copilot-config'; // available if needed

function createMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
    _store: store,
  };
}

beforeEach(() => {
  const mock = createMockStorage();
  vi.stubGlobal('localStorage', mock);
});

describe('getDefaultConfig', () => {
  it('returns correct default values', () => {
    const config = getDefaultConfig();

    expect(config.activeProviderId).toBe('ollama');
    expect(config.applyMode).toBe('manual');
    expect(config.maxHistoryLength).toBe(50);
    expect(config.providers).toHaveProperty('ollama');
    expect(config.providers.ollama?.id).toBe('ollama');
    expect(config.providers.ollama?.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.providers.ollama?.model).toBe('qwen2.5-coder');
    expect(config.providers.ollama?.apiKey).toBe('');
  });
});

describe('saveConfig + loadConfig', () => {
  it('persists and loads config from localStorage', () => {
    const config: CopilotConfig = {
      activeProviderId: 'openai',
      providers: {
        ollama: {
          id: 'ollama',
          name: 'Ollama',
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'qwen2.5-coder',
        },
      },
      applyMode: 'auto',
      maxHistoryLength: 100,
    };

    saveConfig(config);
    const loaded = loadConfig();

    expect(loaded.activeProviderId).toBe('openai');
    expect(loaded.applyMode).toBe('auto');
    expect(loaded.maxHistoryLength).toBe(100);
    expect(loaded.providers.ollama?.model).toBe('qwen2.5-coder');
  });

  it('returns default config when no data in localStorage', () => {
    const loaded = loadConfig();
    const defaults = getDefaultConfig();

    expect(loaded).toEqual(defaults);
  });

  it('returns default config when data is corrupted', () => {
    (localStorage as any).getItem.mockReturnValue('not-valid-json{{{');

    const loaded = loadConfig();
    const defaults = getDefaultConfig();

    expect(loaded).toEqual(defaults);
  });
});
