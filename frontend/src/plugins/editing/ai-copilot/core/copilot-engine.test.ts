import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotEngine, type CopilotEngineCallbacks } from './copilot-engine';
import type { ParsedIntent, RoadActionType } from './types';
import type { ActionResult } from './action-executor';
import type { AIProvider, AIProviderConfig, StreamChunk } from '../providers/types';

// ─── Mocks ───

vi.mock('./intent-parser', () => ({
  parseIntent: vi.fn(),
}));

vi.mock('./action-executor', () => ({
  executeIntent: vi.fn(),
}));

vi.mock('./context-assembler', () => ({
  assembleContext: vi.fn(() => ({ roadCount: 0, laneCount: 0, junctionCount: 0, roads: [], activeRoad: null })),
  contextToPrompt: vi.fn(() => 'mock context'),
}));

vi.mock('./prompt-builder', () => ({
  buildSystemPrompt: vi.fn(() => ({ role: 'system' as const, content: 'system prompt' })),
  buildUserPrompt: vi.fn((input: string) => ({ role: 'user' as const, content: input })),
}));

import { parseIntent } from './intent-parser';
import { executeIntent } from './action-executor';

const mockParseIntent = vi.mocked(parseIntent);
const mockExecuteIntent = vi.mocked(executeIntent);

function makeMockProvider(responseChunks: StreamChunk[] = []): { provider: AIProvider; abortController: AbortController } {
  const ac = new AbortController();
  const provider: AIProvider = {
    chat: vi.fn((_messages, onChunk) => {
      responseChunks.forEach((chunk, i) => {
        setTimeout(() => onChunk(chunk), i * 5);
      });
      return ac;
    }),
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
  };
  return { provider, abortController: ac };
}

const mockConfig: AIProviderConfig = {
  id: 'test',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com',
  apiKey: 'test-key',
  model: 'test-model',
};

function makeIntent(action: RoadActionType, confidence: number, params: Record<string, any> = {}): ParsedIntent {
  return { action, params, confidence, rawInput: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───

describe('CopilotEngine', () => {
  // ── Local action path ──

  describe('local action path (confidence >= 0.85)', () => {
    it('1. /road add 100 → executeIntent → onAction, no AI call', async () => {
      mockParseIntent.mockReturnValue(makeIntent('addRoad', 1.0, { width: 100 }));
      const successResult: ActionResult = { success: true, description: '道路已添加' };
      mockExecuteIntent.mockResolvedValue(successResult);

      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      const onAction = vi.fn();
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onAction, onChunk, onDone, onError };

      await engine.handleInput('/road add 100', callbacks);

      expect(mockExecuteIntent).toHaveBeenCalledOnce();
      expect(onAction).toHaveBeenCalledWith(successResult);
      expect(onChunk).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalled();
    });

    it('2. "删除这条道路" confidence=0.85 → executeIntent → onAction', async () => {
      mockParseIntent.mockReturnValue(makeIntent('removeRoad', 0.85));
      mockExecuteIntent.mockResolvedValue({ success: true, description: '已删除' });

      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      const onAction = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onAction, onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

      await engine.handleInput('删除这条道路', callbacks);

      expect(mockExecuteIntent).toHaveBeenCalledOnce();
      expect(onAction).toHaveBeenCalled();
    });

    it('3. executeIntent returns success=false → onAction contains error', async () => {
      mockParseIntent.mockReturnValue(makeIntent('addRoad', 0.9));
      const failResult: ActionResult = { success: false, description: '操作失败', error: '无效的宽度参数' };
      mockExecuteIntent.mockResolvedValue(failResult);

      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      const onAction = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onAction, onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

      await engine.handleInput('/road add abc', callbacks);

      expect(onAction).toHaveBeenCalledWith(failResult);
    });

    it('4. /help → action=help → executeIntent returns help text', async () => {
      mockParseIntent.mockReturnValue(makeIntent('help', 1.0));
      mockExecuteIntent.mockResolvedValue({ success: true, description: '可用命令列表...' });

      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      const onAction = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onAction, onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

      await engine.handleInput('/help', callbacks);

      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(onAction.mock.calls[0]![0].description).toContain('命令');
    });
  });

  // ── AI chat path ──

  describe('AI chat path (confidence < 0.85 or action=question)', () => {
    it('5. "如何优化这个路口？" confidence=0.5 → AI streaming → onChunk → onDone', async () => {
      mockParseIntent.mockReturnValue(makeIntent('question', 0.5));

      const { provider } = makeMockProvider([
        { type: 'text', content: '建议' },
        { type: 'text', content: '优化' },
        { type: 'done' },
      ]);

      const engine = new CopilotEngine();
      engine.configure(mockConfig);
      // Inject mock provider
      (engine as any).provider = provider;

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onChunk, onAction: vi.fn(), onDone, onError };

      await engine.handleInput('如何优化这个路口？', callbacks);

      // Wait for streaming to complete
      await new Promise((r) => setTimeout(r, 100));

      expect(mockExecuteIntent).not.toHaveBeenCalled();
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onDone).toHaveBeenCalled();
    });

    it('6. AI provider error → onError callback', async () => {
      mockParseIntent.mockReturnValue(makeIntent('question', 0.3));

      const { provider } = makeMockProvider([
        { type: 'error', error: 'API rate limit' },
      ]);

      const engine = new CopilotEngine();
      engine.configure(mockConfig);
      (engine as any).provider = provider;

      const onError = vi.fn();
      const onDone = vi.fn();
      const callbacks: CopilotEngineCallbacks = { onChunk: vi.fn(), onAction: vi.fn(), onDone, onError };

      await engine.handleInput('问个问题', callbacks);
      await new Promise((r) => setTimeout(r, 100));

      expect(onError).toHaveBeenCalledWith('API rate limit');
    });

    it('7. abort() cancels provider request', async () => {
      mockParseIntent.mockReturnValue(makeIntent('question', 0.4));

      const abortController = new AbortController();
      const provider: AIProvider = {
        chat: vi.fn(() => abortController),
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
      };

      const engine = new CopilotEngine();
      engine.configure(mockConfig);
      (engine as any).provider = provider;

      const callbacks: CopilotEngineCallbacks = { onChunk: vi.fn(), onAction: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

      const promise = engine.handleInput('说点什么', callbacks);
      engine.abort();
      await promise;

      expect(abortController.signal.aborted).toBe(true);
    });

    it('8. reset() clears conversation history', async () => {
      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      mockParseIntent.mockReturnValue(makeIntent('question', 0.2));
      const { provider } = makeMockProvider([{ type: 'done' }]);
      (engine as any).provider = provider;

      await engine.handleInput('hello', { onChunk: vi.fn(), onAction: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
      await new Promise((r) => setTimeout(r, 50));

      expect(engine.getHistory().length).toBeGreaterThan(0);
      engine.reset();
      expect(engine.getHistory().length).toBe(0);
    });
  });

  // ── State management ──

  describe('state management', () => {
    it('9. configured provider → handleInput works', async () => {
      mockParseIntent.mockReturnValue(makeIntent('help', 1.0));
      mockExecuteIntent.mockResolvedValue({ success: true, description: '' });

      const engine = new CopilotEngine();
      engine.configure(mockConfig);

      await expect(engine.handleInput('/help', { onChunk: vi.fn(), onAction: vi.fn(), onDone: vi.fn(), onError: vi.fn() })).resolves.not.toThrow();
    });

    it('10. no provider configured → local actions still work', async () => {
      mockParseIntent.mockReturnValue(makeIntent('addRoad', 1.0));
      mockExecuteIntent.mockResolvedValue({ success: true, description: '' });

      const engine = new CopilotEngine();
      // No configure() call

      await expect(engine.handleInput('/road add 100', { onChunk: vi.fn(), onAction: vi.fn(), onDone: vi.fn(), onError: vi.fn() })).resolves.not.toThrow();
    });

    it('11. getHistory returns correct messages', async () => {
      mockParseIntent.mockReturnValue(makeIntent('question', 0.2));

      const { provider } = makeMockProvider([{ type: 'text', content: '回复内容' }, { type: 'done' }]);
      const engine = new CopilotEngine();
      engine.configure(mockConfig);
      (engine as any).provider = provider;

      await engine.handleInput('你好', { onChunk: vi.fn(), onAction: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
      await new Promise((r) => setTimeout(r, 100));

      const history = engine.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0]!.role).toBe('user');
      expect(history[0]!.content).toBe('你好');
    });
  });
});
