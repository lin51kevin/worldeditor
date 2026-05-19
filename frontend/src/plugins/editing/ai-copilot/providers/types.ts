export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChunk {
  type: 'text' | 'done' | 'error';
  content?: string;
  error?: string;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AIProvider {
  chat(messages: CopilotMessage[], onChunk: (chunk: StreamChunk) => void): AbortController;
}
