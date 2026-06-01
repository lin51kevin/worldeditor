import type { AIProvider, AIProviderConfig, CopilotMessage, ModelInfo, StreamChunk } from './types';

/**
 * OpenAI-compatible streaming provider using native fetch + ReadableStream.
 */
export class OpenAICompatibleProvider implements AIProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(config: AIProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /** Lightweight connectivity check — GET /models with 5s timeout */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      return response.ok;
    } catch (err) {
      if (err instanceof TypeError) {
        // TypeError typically indicates a network error or CORS failure
        throw new Error('network_error', { cause: err });
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Fetch available models from the provider's /models endpoint */
  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        return [];
      }

      const json = await response.json();
      const data = json.data ?? json;
      if (!Array.isArray(data)) return [];

      return data.map((m: { id: string; name?: string }) => ({
        id: m.id,
        name: m.name,
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  chat(messages: CopilotMessage[], onChunk: (chunk: StreamChunk) => void): AbortController {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          onChunk({ type: 'error', error: `HTTP ${response.status}: ${detail}` });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onChunk({ type: 'error', error: 'No response body' });
          return;
        }

        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n').filter((l) => l.startsWith('data: '));

            for (const line of lines) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                onChunk({ type: 'done' });
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  onChunk({ type: 'text', content: delta });
                }
              } catch {
                // skip malformed lines
              }
            }
          }
          onChunk({ type: 'done' });
        } finally {
          try { await reader.cancel(); } catch { /* ignore */ }
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        onChunk({ type: 'error', error: msg });
      }
    })();

    return controller;
  }
}
