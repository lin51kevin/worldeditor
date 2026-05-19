import { describe, it, expect } from 'vitest';
import { parseIntent, getQuickCommandList } from './intent-parser';
import type { ParsedIntent, RoadActionType } from './types';

function expectIntent(
  result: ParsedIntent,
  action: RoadActionType,
  confidence: number,
  partialParams?: Record<string, any>,
  rawInput?: string,
) {
  expect(result.action).toBe(action);
  expect(result.confidence).toBe(confidence);
  if (partialParams) {
    expect(result.params).toMatchObject(partialParams);
  }
  if (rawInput !== undefined) {
    expect(result.rawInput).toBe(rawInput);
  }
}

describe('parseIntent', () => {
  // ─── Slash commands (confidence=1.0) ───

  describe('slash commands', () => {
    it('/road add → addRoad', () => {
      expectIntent(parseIntent('/road add'), 'addRoad', 1.0);
    });
    it('/road add 100 → addRoad with length=100', () => {
      const r = parseIntent('/road add 100');
      expectIntent(r, 'addRoad', 1.0, { length: '100' });
    });
    it('/road add 50.5 → addRoad with length=50.5', () => {
      expectIntent(parseIntent('/road add 50.5'), 'addRoad', 1.0, { length: '50.5' });
    });
    it('/road delete → removeRoad', () => {
      expectIntent(parseIntent('/road delete'), 'removeRoad', 1.0);
    });
    it('/road split → splitRoad', () => {
      expectIntent(parseIntent('/road split'), 'splitRoad', 1.0);
    });
    it('/road reverse → reverseRoad', () => {
      expectIntent(parseIntent('/road reverse'), 'reverseRoad', 1.0);
    });
    it('/road mirror → mirrorRoad', () => {
      expectIntent(parseIntent('/road mirror'), 'mirrorRoad', 1.0);
    });

    // lane commands
    it('/lane add → addLane with default params', () => {
      const r = parseIntent('/lane add');
      expectIntent(r, 'addLane', 1.0);
    });
    it('/lane add left → addLane with side=left', () => {
      expectIntent(parseIntent('/lane add left'), 'addLane', 1.0, { side: 'left' });
    });
    it('/lane add right driving → addLane with side=right, type=driving', () => {
      expectIntent(parseIntent('/lane add right driving'), 'addLane', 1.0, { side: 'right', type: 'driving' });
    });
    it('/lane delete left → removeLane with side=left', () => {
      expectIntent(parseIntent('/lane delete left'), 'removeLane', 1.0, { side: 'left' });
    });
    it('/lane width 3.5 → updateLaneWidth with meters=3.5', () => {
      expectIntent(parseIntent('/lane width 3.5'), 'updateLaneWidth', 1.0, { meters: '3.5' });
    });

    // other commands
    it('/junction create → createJunction', () => {
      expectIntent(parseIntent('/junction create'), 'createJunction', 1.0);
    });
    it('/signal add → addSignal', () => {
      expectIntent(parseIntent('/signal add'), 'addSignal', 1.0);
    });
    it('/marking add → addRoadMark', () => {
      expectIntent(parseIntent('/marking add'), 'addRoadMark', 1.0);
    });
    it('/help → help', () => {
      expectIntent(parseIntent('/help'), 'help', 1.0);
    });
  });

  // ─── Slash commands with extra whitespace ───

  describe('slash command edge cases', () => {
    it('handles leading/trailing spaces', () => {
      expectIntent(parseIntent('  /road add  '), 'addRoad', 1.0);
    });
    it('handles case-insensitive road subcommand', () => {
      expectIntent(parseIntent('/road ADD'), 'addRoad', 1.0);
    });
    it('unknown slash command falls to question', () => {
      expectIntent(parseIntent('/unknown'), 'question', 0.5);
    });
  });

  // ─── Chinese natural language (confidence=0.85) ───

  describe('Chinese natural language', () => {
    // addLane
    it('"加一条车道" → addLane', () => {
      expectIntent(parseIntent('加一条车道'), 'addLane', 0.85);
    });
    it('"左边加一条车道" → addLane with side=left', () => {
      expectIntent(parseIntent('左边加一条车道'), 'addLane', 0.85, { side: 'left' });
    });
    it('"右边加一条车道" → addLane with side=right', () => {
      expectIntent(parseIntent('右边加一条车道'), 'addLane', 0.85, { side: 'right' });
    });

    // removeRoad
    it('"删除这条道路" → removeRoad', () => {
      expectIntent(parseIntent('删除这条道路'), 'removeRoad', 0.85);
    });
    it('"删掉这条路" → removeRoad', () => {
      expectIntent(parseIntent('删掉这条路'), 'removeRoad', 0.85);
    });

    // splitRoad
    it('"切开这条道路" → splitRoad', () => {
      expectIntent(parseIntent('切开这条道路'), 'splitRoad', 0.85);
    });
    it('"分割这条道路" → splitRoad', () => {
      expectIntent(parseIntent('分割这条道路'), 'splitRoad', 0.85);
    });
    it('"切割这条道路" → splitRoad', () => {
      expectIntent(parseIntent('切割这条道路'), 'splitRoad', 0.85);
    });

    // reverseRoad
    it('"反转这条道路" → reverseRoad', () => {
      expectIntent(parseIntent('反转这条道路'), 'reverseRoad', 0.85);
    });
    it('"翻转这条道路" → reverseRoad', () => {
      expectIntent(parseIntent('翻转这条道路'), 'reverseRoad', 0.85);
    });

    // mirrorRoad
    it('"镜像这条道路" → mirrorRoad', () => {
      expectIntent(parseIntent('镜像这条道路'), 'mirrorRoad', 0.85);
    });

    // updateLaneWidth
    it('"车道宽度改成3.5米" → updateLaneWidth', () => {
      expectIntent(parseIntent('车道宽度改成3.5米'), 'updateLaneWidth', 0.85, { meters: '3.5' });
    });
    it('"车道宽度调整为4米" → updateLaneWidth', () => {
      expectIntent(parseIntent('车道宽度调整为4米'), 'updateLaneWidth', 0.85, { meters: '4' });
    });

    // createJunction
    it('"创建路口" → createJunction', () => {
      expectIntent(parseIntent('创建路口'), 'createJunction', 0.85);
    });
    it('"建一个路口" → createJunction', () => {
      expectIntent(parseIntent('建一个路口'), 'createJunction', 0.85);
    });

    // addSignal
    it('"添加信号灯" → addSignal', () => {
      expectIntent(parseIntent('添加信号灯'), 'addSignal', 0.85);
    });

    // addRoadMark
    it('"添加标线" → addRoadMark', () => {
      expectIntent(parseIntent('添加标线'), 'addRoadMark', 0.85);
    });
    it('"地面标线" → addRoadMark', () => {
      expectIntent(parseIntent('添加地面标线'), 'addRoadMark', 0.85);
    });
  });

  // ─── Default fallback ───

  describe('default fallback', () => {
    it('unrecognized Chinese → question', () => {
      expectIntent(parseIntent('今天天气怎么样'), 'question', 0.5);
    });
    it('random English → question', () => {
      expectIntent(parseIntent('hello world'), 'question', 0.5);
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('empty string → question', () => {
      expectIntent(parseIntent(''), 'question', 0.5);
    });
    it('pure spaces → question', () => {
      expectIntent(parseIntent('   '), 'question', 0.5);
    });
    it('rawInput is preserved', () => {
      const input = '  加一条车道  ';
      expect(parseIntent(input).rawInput).toBe(input.trim());
    });
  });

  // ─── getQuickCommandList ───

  describe('getQuickCommandList', () => {
    it('returns non-empty array', () => {
      const list = getQuickCommandList();
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('command');
      expect(list[0]).toHaveProperty('label');
      expect(list[0]).toHaveProperty('description');
    });
  });
});
