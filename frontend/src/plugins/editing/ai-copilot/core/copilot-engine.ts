import { parseIntent } from './intent-parser';
import { assembleContext, contextToPrompt } from './context-assembler';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder';
import { executeIntent } from './action-executor';
import type { ParsedIntent } from './types';
import type { CopilotMessage, AIProvider, AIProviderConfig, StreamChunk } from '../providers/types';
import { OpenAICompatibleProvider } from '../providers/openai-compatible';

export interface CopilotEngineCallbacks {
  onChunk: (text: string) => void;
  onAction: (result: any) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/** Regex to extract [ACTION]{...}[/ACTION] from AI response */
const ACTION_TAG_RE = /\[ACTION\]\s*(\{[\s\S]*?\})\s*\[\/ACTION\]/;

export class CopilotEngine {
  private messages: CopilotMessage[] = [];
  private provider: AIProvider | null = null;
  private currentAbort: AbortController | null = null;

  configure(config: AIProviderConfig): void {
    this.provider = new OpenAICompatibleProvider(config);
  }

  async handleInput(input: string, callbacks: CopilotEngineCallbacks): Promise<void> {
    // 1. Add user message to history
    const userMsg: CopilotMessage = { role: 'user', content: input };
    this.messages.push(userMsg);

    // 2. Parse intent
    const intent = parseIntent(input);

    // 3. Local action path
    if (intent.confidence >= 0.85 && intent.action !== 'question') {
      try {
        const result = await executeIntent(intent);
        callbacks.onAction(result);
        // Store result as assistant message
        const reply = result.success ? result.description : (result.error || result.description || '操作失败');
        this.messages.push({ role: 'assistant', content: reply });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        callbacks.onError(errMsg);
        this.messages.push({ role: 'assistant', content: `错误: ${errMsg}` });
      }
      callbacks.onDone();
      return;
    }

    // 4. AI chat path
    if (!this.provider) {
      callbacks.onError('AI provider 未配置');
      callbacks.onDone();
      return;
    }

    try {
      const ctx = assembleContext();
      const contextStr = contextToPrompt(ctx);
      const sysMsg = buildSystemPrompt(contextStr);
      const promptUserMsg = buildUserPrompt(input, contextStr);

      let fullReply = '';

      this.currentAbort = this.provider.chat(
        [sysMsg, ...this.messages.slice(0, -1), promptUserMsg],
        (chunk: StreamChunk) => {
          if (chunk.type === 'text' && chunk.content) {
            fullReply += chunk.content;
            callbacks.onChunk(chunk.content);
          } else if (chunk.type === 'error' && chunk.error) {
            callbacks.onError(chunk.error);
          } else if (chunk.type === 'done') {
            if (fullReply) {
              this.messages.push({ role: 'assistant', content: fullReply });
              // Try to extract and execute embedded action
              this.tryExecuteEmbeddedAction(fullReply, callbacks);
            }
            callbacks.onDone();
          }
        },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      callbacks.onError(errMsg);
      callbacks.onDone();
    }
  }

  /** Extract [ACTION]...[/ACTION] from AI reply and execute if found */
  private async tryExecuteEmbeddedAction(reply: string, callbacks: CopilotEngineCallbacks): Promise<void> {
    const match = reply.match(ACTION_TAG_RE);
    if (!match) return;

    try {
      const parsed = JSON.parse(match[1]!) as { action: string; params?: Record<string, any> };
      if (!parsed.action) return;

      const intent: ParsedIntent = {
        action: parsed.action as ParsedIntent['action'],
        params: parsed.params ?? {},
        confidence: 0.9,
        rawInput: reply,
      };

      const result = await executeIntent(intent);
      callbacks.onAction(result);
    } catch {
      // Silently ignore malformed action tags
    }
  }

  abort(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  reset(): void {
    this.messages = [];
    this.abort();
  }

  getHistory(): CopilotMessage[] {
    return [...this.messages];
  }
}
