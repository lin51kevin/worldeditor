import type { AIProviderConfig } from './types';

export interface ProviderPreset {
  id: string;
  name: string;
  /** 'cloud' requires API key; 'local' does not */
  type: 'cloud' | 'local';
  baseUrl: string;
  models: string[];
  defaultModel: string;
  /** Short description shown in the UI */
  description?: string;
  /** Link to the provider's API key management page */
  apiKeyUrl?: string;
  /** Placeholder text for the API key input */
  apiKeyPlaceholder?: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'local',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.3:70b', 'qwen2.5:14b', 'qwen2.5:7b', 'deepseek-r1', 'deepseek-coder', 'gemma3:27b', 'phi-4'],
    defaultModel: 'qwen2.5:14b',
    description: '本地模型推理 (无需 API Key)',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o-mini',
    description: 'OpenAI GPT models',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    type: 'cloud',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-3.5-sonnet-20240620', 'claude-3.5-haiku-20241022'],
    defaultModel: 'claude-3.5-sonnet-20240620',
    description: 'Anthropic Claude models',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'cloud',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen3-coder:free',
      'google/gemma-3-27b-it:free',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'openai/gpt-4o',
      'anthropic/claude-sonnet-4',
    ],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    description: '200+ 模型统一入口，免费模型 ID 末尾带 :free',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    apiKeyPlaceholder: 'sk-or-v1-...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'cloud',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek AI models',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    type: 'cloud',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-auto', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-auto',
    description: 'Moonshot Kimi models',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    type: 'cloud',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    defaultModel: 'glm-4-flash',
    description: '智谱 ChatGLM 系列',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiKeyPlaceholder: 'xxx.yyy',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI Compatible)',
    type: 'cloud',
    baseUrl: '',
    models: [],
    defaultModel: '',
    description: '任意 OpenAI 兼容 API 端点',
    apiKeyPlaceholder: 'your-api-key',
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function presetToConfig(preset: ProviderPreset, apiKey: string): AIProviderConfig {
  return {
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey,
    model: preset.defaultModel,
  };
}
