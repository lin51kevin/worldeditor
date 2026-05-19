import type { ParsedIntent, RoadActionType } from './types';

// ─── Slash command registry ───

interface SlashCommand {
  regex: RegExp;
  action: RoadActionType;
  extractParams?: (m: RegExpMatchArray) => Record<string, any>;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { regex: /^\/road\s+add(?:\s+(\d+(?:\.\d+)?))?/i, action: 'addRoad', extractParams: (m) => m[1] ? { length: m[1] } : {} },
  { regex: /^\/road\s+delete/i, action: 'removeRoad' },
  { regex: /^\/road\s+split/i, action: 'splitRoad' },
  { regex: /^\/road\s+reverse/i, action: 'reverseRoad' },
  { regex: /^\/road\s+mirror/i, action: 'mirrorRoad' },
  {
    regex: /^\/lane\s+add(?:\s+(left|right))?(?:\s+(driving|turning|biking|walking))?/i,
    action: 'addLane',
    extractParams: (m) => ({ ...(m[1] ? { side: m[1] } : {}), ...(m[2] ? { type: m[2] } : {}) }),
  },
  {
    regex: /^\/lane\s+delete(?:\s+(left|right))?/i,
    action: 'removeLane',
    extractParams: (m) => m[1] ? { side: m[1] } : {},
  },
  { regex: /^\/lane\s+width\s+(\d+(?:\.\d+)?)/i, action: 'updateLaneWidth', extractParams: (m) => ({ meters: m[1] }) },
  { regex: /^\/junction\s+create/i, action: 'createJunction' },
  { regex: /^\/signal\s+add/i, action: 'addSignal' },
  { regex: /^\/marking\s+add/i, action: 'addRoadMark' },
  { regex: /^\/help/i, action: 'help' },
];

// ─── Quick command list for UI ───

export function getQuickCommandList(): Array<{ command: string; label: string; description: string }> {
  return [
    { command: '/road add [length]', label: 'Add Road', description: 'Add a new road with optional length' },
    { command: '/road delete', label: 'Delete Road', description: 'Delete the selected road' },
    { command: '/road split', label: 'Split Road', description: 'Split the selected road' },
    { command: '/road reverse', label: 'Reverse Road', description: 'Reverse direction of the road' },
    { command: '/road mirror', label: 'Mirror Road', description: 'Mirror the selected road' },
    { command: '/lane add [side] [type]', label: 'Add Lane', description: 'Add a lane (side: left/right, type: driving/turning/biking/walking)' },
    { command: '/lane delete [side]', label: 'Delete Lane', description: 'Remove a lane from one side' },
    { command: '/lane width [m]', label: 'Lane Width', description: 'Update lane width in meters' },
    { command: '/junction create', label: 'Create Junction', description: 'Create a junction at intersection' },
    { command: '/signal add', label: 'Add Signal', description: 'Add a traffic signal' },
    { command: '/marking add', label: 'Add Marking', description: 'Add road markings' },
    { command: '/help', label: 'Help', description: 'Show available commands' },
  ];
}

// ─── Natural language patterns (Chinese) ───

interface NLPattern {
  regex: RegExp;
  action: RoadActionType;
  extractParams?: (m: RegExpMatchArray) => Record<string, any>;
}

const NL_PATTERNS: NLPattern[] = [
  // addLane — check before removeRoad since "加" appears in many contexts
  { regex: /(?:左|左侧|左边)加.*?车道/, action: 'addLane', extractParams: () => ({ side: 'left' }) },
  { regex: /(?:右|右侧|右边)加.*?车道/, action: 'addLane', extractParams: () => ({ side: 'right' }) },
  { regex: /加.*?车道/, action: 'addLane' },

  // removeRoad
  { regex: /删除.*(?:道路|路)/, action: 'removeRoad' },
  { regex: /删掉.*(?:道路|路)/, action: 'removeRoad' },

  // splitRoad
  { regex: /(?:切开|切割|分割).*道路/, action: 'splitRoad' },

  // reverseRoad
  { regex: /(?:反转|翻转).*道路/, action: 'reverseRoad' },

  // mirrorRoad
  { regex: /镜像.*道路/, action: 'mirrorRoad' },

  // updateLaneWidth
  { regex: /车道宽度(?:改成|调整为|设为|修改为)\s*(\d+(?:\.\d+)?)\s*米/, action: 'updateLaneWidth', extractParams: (m) => ({ meters: m[1] }) },

  // createJunction
  { regex: /(?:创建|建)\s*(?:一个\s*)?路口/, action: 'createJunction' },

  // addSignal
  { regex: /添加.*信号灯/, action: 'addSignal' },

  // addRoadMark
  { regex: /添加.*(?:地面\s*)?标线/, action: 'addRoadMark' },
];

// ─── Main parse function ───

export function parseIntent(input: string): ParsedIntent {
  const trimmed = input.trim();

  if (!trimmed) {
    return { action: 'question', params: { instruction: '' }, confidence: 0.5, rawInput: trimmed };
  }

  // 1. Slash commands (confidence=1.0)
  for (const cmd of SLASH_COMMANDS) {
    const match = trimmed.match(cmd.regex);
    if (match) {
      return {
        action: cmd.action,
        params: cmd.extractParams ? cmd.extractParams(match) : {},
        confidence: 1.0,
        rawInput: trimmed,
      };
    }
  }

  // 2. Natural language patterns (confidence=0.85)
  for (const pattern of NL_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return {
        action: pattern.action,
        params: pattern.extractParams ? pattern.extractParams(match) : {},
        confidence: 0.85,
        rawInput: trimmed,
      };
    }
  }

  // 3. Default: question (confidence=0.5)
  return {
    action: 'question',
    params: { instruction: trimmed },
    confidence: 0.5,
    rawInput: trimmed,
  };
}
