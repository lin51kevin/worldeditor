import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { CopilotMessage, StreamChunk } from './types';

function makeConfig(overrides?: Record<string, string>) {
  return {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    ...overrides,
  };
}

const messages: CopilotMessage[] = [{ role: 'user', content: 'hello' }];

// Helper: create a ReadableStream from SSE lines
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n') + '\n';
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        controller.enqueue(encoder.encode(data));
        controller.close();
        sent = true;
      }
    },
  });
}

describe('OpenAICompatibleProvider', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should receive multiple text chunks and done', async () => {
    const sse = sseStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: sse,
    });

    const provider = new OpenAICompatibleProvider(makeConfig());
    const chunks: StreamChunk[] = [];

    await new Promise<void>((resolve) => {
      provider.chat(messages, (c) => {
        chunks.push(c);
        if (c.type === 'done' || c.type === 'error') resolve();
      });
    });

    expect(chunks).toEqual([
      { type: 'text', content: 'Hello' },
      { type: 'text', content: ' world' },
      { type: 'done' },
    ]);
  });

  it('should emit done on [DONE] signal', async () => {
    const sse = sseStream([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: [DONE]',
    ]);

    mockFetch.mockResolvedValueOnce({ ok: true, body: sse });

    const provider = new OpenAICompatibleProvider(makeConfig());
    const chunks: StreamChunk[] = [];

    await new Promise<void>((resolve) => {
      provider.chat(messages, (c) => {
        chunks.push(c);
        if (c.type === 'done' || c.type === 'error') resolve();
      });
    });

    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('should cancel via AbortController', async () => {
    const controller = new ReadableStream({
      start(ctl) {
        // Never close — stream hangs
        setTimeout(() => ctl.enqueue(new TextEncoder().encode('data: {}\n\n')), 10000);
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: controller });

    const provider = new OpenAICompatibleProvider(makeConfig());
    const chunks: StreamChunk[] = [];

    const abort = provider.chat(messages, (c) => chunks.push(c));
    abort.abort();

    // Wait a bit to ensure no unexpected chunks
    await new Promise((r) => setTimeout(r, 50));

    // Should have no chunks (aborted before any data)
    expect(chunks.length).toBe(0);
  });

  it('should emit error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const provider = new OpenAICompatibleProvider(makeConfig());
    const chunks: StreamChunk[] = [];

    await new Promise<void>((resolve) => {
      provider.chat(messages, (c) => {
        chunks.push(c);
        if (c.type === 'done' || c.type === 'error') resolve();
      });
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe('error');
    expect(chunks[0]!.error).toContain('Failed to fetch');
  });

  it('should emit error on non-200 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"invalid api key"}'),
    });

    const provider = new OpenAICompatibleProvider(makeConfig());
    const chunks: StreamChunk[] = [];

    await new Promise<void>((resolve) => {
      provider.chat(messages, (c) => {
        chunks.push(c);
        if (c.type === 'done' || c.type === 'error') resolve();
      });
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe('error');
    expect(chunks[0]!.error).toContain('HTTP 401');
  });
});
