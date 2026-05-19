import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder';

describe('prompt-builder', () => {
  describe('buildSystemPrompt', () => {
    it('should include role definition', () => {
      const prompt = buildSystemPrompt('test project');
      expect(prompt.role).toBe('system');
      expect(prompt.content).toContain('WorldEditor');
      expect(prompt.content).toContain('AI');
    });

    it('should include available actions', () => {
      const prompt = buildSystemPrompt('');
      expect(prompt.content).toContain('addRoad');
      expect(prompt.content).toContain('removeRoad');
      expect(prompt.content).toContain('reverseRoad');
    });

    it('should include project context', () => {
      const prompt = buildSystemPrompt('Roads: 5, Junctions: 2');
      expect(prompt.content).toContain('Roads: 5, Junctions: 2');
    });

    it('should include output format requirements', () => {
      const prompt = buildSystemPrompt('');
      expect(prompt.content).toContain('JSON');
    });
  });

  describe('buildUserPrompt', () => {
    it('should include user input', () => {
      const prompt = buildUserPrompt('添加一条道路', 'test');
      expect(prompt.role).toBe('user');
      expect(prompt.content).toContain('添加一条道路');
    });

    it('should include context', () => {
      const prompt = buildUserPrompt('test', '当前选中: Road-001');
      expect(prompt.content).toContain('当前选中: Road-001');
    });
  });
});
