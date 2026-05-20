import type { ParsedIntent, RoadActionType } from './types';

// ─── Config types ───

interface ParamPattern {
  patterns: string[];
  type: 'number' | 'boolean' | 'string' | 'enum';
  default?: any;
  mapping?: Record<string, string>;
}

interface IntentConfig {
  action: RoadActionType;
  keywords: string[];
  synonyms: Record<string, string[]>;
  paramPatterns: Record<string, ParamPattern>;
  requiresSelection: boolean;
  priority: number;
  description?: string;
}

interface SlashCommandConfig {
  pattern: string;
  action: RoadActionType;
  paramHint?: string;
}

interface IntentsConfigFile {
  version: number;
  intents: IntentConfig[];
  slashCommands: SlashCommandConfig[];
}

// ─── Config loading ───

let _configCache: IntentsConfigFile | null = null;
let _configLoading: Promise<IntentsConfigFile> | null = null;
const USER_CONFIG_RELATIVE_PATH = ['plugins', 'ai-copilot', 'intents.json'];

/** Load intents config from public/config/intents.json */
async function loadConfig(): Promise<IntentsConfigFile> {
  if (_configCache) return _configCache;
  if (_configLoading) return _configLoading;

  _configLoading = (async () => {
    const bundled = await loadBundledConfig();

    if (!isTauriRuntime()) {
      _configCache = bundled;
      return bundled;
    }

    try {
      const userConfig = await loadUserConfig(bundled);
      _configCache = userConfig;
      return userConfig;
    } catch (error) {
      console.warn('[intent-parser] Falling back to bundled config:', error);
      _configCache = bundled;
      return bundled;
    }
  })();

  return _configLoading;
}

/** Get cached config synchronously (returns null if not yet loaded) */
function getCachedConfig(): IntentsConfigFile | null {
  return _configCache;
}

/** Pre-load config at module init */
void loadConfig();

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function loadBundledConfig(): Promise<IntentsConfigFile> {
  if (import.meta.env.MODE === 'test') {
    return getDefaultConfig();
  }

  try {
    const res = await fetch(getBundledConfigUrl());
    if (!res.ok) {
      throw new Error(`Failed to load intents config: ${res.status}`);
    }
    return (await res.json()) as IntentsConfigFile;
  } catch (error) {
    console.warn('[intent-parser] Bundled config load failed, using embedded defaults:', error);
    return getDefaultConfig();
  }
}

function getBundledConfigUrl(): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL('/config/intents.json', window.location.href).toString();
  }
  return 'http://localhost/config/intents.json';
}

async function loadUserConfig(defaultConfig: IntentsConfigFile): Promise<IntentsConfigFile> {
  const { appConfigDir, join } = await import('@tauri-apps/api/path');
  const { exists, mkdir, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');

  const configDir = await join(await appConfigDir(), ...USER_CONFIG_RELATIVE_PATH.slice(0, -1));
  const configPath = await join(configDir, USER_CONFIG_RELATIVE_PATH[2]!);

  if (!(await exists(configPath))) {
    await mkdir(configDir, { recursive: true });
    await writeTextFile(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }

  try {
    const raw = await readTextFile(configPath);
    const parsed = JSON.parse(raw) as IntentsConfigFile;
    return parsed;
  } catch (error) {
    console.warn(`[intent-parser] Invalid user config at ${configPath}, using bundled default:`, error);
    return defaultConfig;
  }
}

// ─── Synonym expansion ───

function expandKeywords(intent: IntentConfig, minSynLength = 1): string[] {
  const expanded = new Set<string>();

  for (const kw of intent.keywords) {
    expanded.add(kw);
  }

  // Generate variants by replacing synonym keys with their alternatives
  for (const kw of intent.keywords) {
    for (const [word, synonyms] of Object.entries(intent.synonyms)) {
      if (kw.includes(word)) {
        for (const syn of synonyms) {
          if (syn.length >= minSynLength) {
            expanded.add(kw.replace(word, syn));
          }
        }
      }
    }
  }

  return Array.from(expanded);
}

// ─── Parameter extraction ───

function extractParams(input: string, paramPatterns: Record<string, ParamPattern>): Record<string, any> {
  const params: Record<string, any> = {};

  for (const [name, config] of Object.entries(paramPatterns)) {
    let matched = false;

    for (const pattern of config.patterns) {
      const regex = new RegExp(pattern);
      const match = input.match(regex);
      if (match) {
        const rawValue = match[1] || match[0];

        if (config.type === 'number') {
          params[name] = parseFloat(rawValue);
        } else if (config.type === 'boolean') {
          params[name] = true;
        } else if (config.type === 'enum' && config.mapping) {
          params[name] = config.mapping[rawValue] ?? rawValue;
        } else {
          params[name] = rawValue;
        }
        matched = true;
        break;
      }
    }

    if (!matched && config.default !== undefined) {
      params[name] = config.default;
    }
  }

  return params;
}

// ─── Fuzzy matching (two-pass: exact keyword → concept matching) ───

function matchIntent(input: string, intents: IntentConfig[]): { intent: IntentConfig; score: number } | null {
  // Pass 1: Exact keyword substring matching (use minSynLength=2 to avoid
  // single-char synonyms creating overly short expanded keywords that
  // cause false positives, e.g. "创建路" matching in "创建路口")
  let bestExact: { intent: IntentConfig; score: number } | null = null;

  for (const intent of intents) {
    const expandedKeywords = expandKeywords(intent, 2);
    for (const kw of expandedKeywords) {
      if (input.includes(kw)) {
        const score = kw.length * 2 + intent.priority;
        if (!bestExact || score > bestExact.score) {
          bestExact = { intent, score };
        }
      }
    }
  }

  if (bestExact) return bestExact;

  // Pass 2: Concept matching — all synonym groups must have at least one
  // variant present in the input. Uses all synonyms including single-char.
  let bestConcept: { intent: IntentConfig; score: number } | null = null;

  for (const intent of intents) {
    const synonymGroups = Object.entries(intent.synonyms);
    if (synonymGroups.length === 0) continue;

    let allMatched = true;
    let totalScore = 0;

    for (const [key, synonyms] of synonymGroups) {
      const variants = [key, ...synonyms];
      // Find the longest matching variant for scoring
      let bestVariantLen = 0;
      for (const v of variants) {
        if (input.includes(v) && v.length > bestVariantLen) {
          bestVariantLen = v.length;
        }
      }
      if (bestVariantLen > 0) {
        totalScore += bestVariantLen;
      } else {
        allMatched = false;
        break;
      }
    }

    if (allMatched) {
      const score = totalScore + intent.priority;
      if (!bestConcept || score > bestConcept.score) {
        bestConcept = { intent, score };
      }
    }
  }

  return bestConcept;
}

// ─── Slash command parsing ───

const SLASH_PARAM_EXTRACTORS: Record<string, (args: string) => Record<string, any>> = {
  addRoad: (args) => {
    const m = args.match(/(\d+(?:\.\d+)?)/);
    return m ? { length: m[1] } : {};
  },
  addLane: (args) => {
    const params: Record<string, any> = {};
    const sideMatch = args.match(/\b(left|right)\b/i);
    if (sideMatch) params.side = sideMatch[1]!.toLowerCase();
    const typeMatch = args.match(/\b(driving|turning|biking|walking)\b/i);
    if (typeMatch) params.type = typeMatch[1]!.toLowerCase();
    return params;
  },
  removeLane: (args) => {
    const sideMatch = args.match(/\b(left|right)\b/i);
    return sideMatch ? { side: sideMatch[1]!.toLowerCase() } : {};
  },
  updateLaneWidth: (args) => {
    const m = args.match(/(\d+(?:\.\d+)?)/);
    return m ? { meters: m[1] } : {};
  },
};

function parseSlashCommand(input: string, config: IntentsConfigFile): ParsedIntent | null {
  for (const cmd of config.slashCommands) {
    if (input.toLowerCase().startsWith(cmd.pattern.toLowerCase())) {
      const args = input.slice(cmd.pattern.length).trim();
      const extractor = SLASH_PARAM_EXTRACTORS[cmd.action];
      const params = extractor ? extractor(args) : {};
      return {
        action: cmd.action,
        params,
        confidence: 1.0,
        rawInput: input,
      };
    }
  }
  return null;
}

// ─── Quick command list for UI ───

export function getQuickCommandList(): Array<{ command: string; label: string; description: string }> {
  const config = getCachedConfig();
  if (!config) {
    // Fallback before config loads
    return getDefaultQuickCommands();
  }

  return config.slashCommands
    .filter((cmd) => cmd.action !== 'help')
    .map((cmd) => {
      const intent = config.intents.find((i) => i.action === cmd.action);
      return {
        command: cmd.paramHint ? `${cmd.pattern} ${cmd.paramHint}` : cmd.pattern,
        label: intent?.description ?? cmd.action,
        description: intent?.description ?? `Execute ${cmd.action}`,
      };
    })
    .concat([{ command: '/help', label: '帮助', description: '显示可用命令列表' }]);
}

// ─── Main parse function ───

export function parseIntent(input: string): ParsedIntent {
  const trimmed = input.trim();

  if (!trimmed) {
    return { action: 'question', params: { instruction: '' }, confidence: 0.5, rawInput: trimmed };
  }

  const config = getCachedConfig() ?? getDefaultConfig();

  // 1. Slash commands (confidence=1.0)
  if (trimmed.startsWith('/')) {
    const slashResult = parseSlashCommand(trimmed, config);
    if (slashResult) return slashResult;
  }

  // 2. Config-driven fuzzy matching (confidence=0.85)
  const match = matchIntent(trimmed, config.intents);
  if (match) {
    const params = extractParams(trimmed, match.intent.paramPatterns);
    return {
      action: match.intent.action,
      params,
      confidence: 0.85,
      rawInput: trimmed,
    };
  }

  // 3. Default: question (confidence=0.5) — AI model fallback
  return {
    action: 'question',
    params: { instruction: trimmed },
    confidence: 0.5,
    rawInput: trimmed,
  };
}

// ─── Allow runtime config reload (for testing or hot-update) ───

export function setIntentsConfig(config: IntentsConfigFile): void {
  _configCache = config;
}

export function resetIntentsConfig(): void {
  _configCache = null;
  _configLoading = null;
}

export function getIntentsConfigPathHint(): string {
  return USER_CONFIG_RELATIVE_PATH.join('/');
}

// ─── Default fallback config (embedded) ───

function getDefaultQuickCommands() {
  return [
    { command: '/road add [length]', label: '添加新道路（支持指定长度、车道数、双向）', description: '添加新道路（支持指定长度、车道数、双向）' },
    { command: '/road delete', label: '删除选中的道路', description: '删除选中的道路' },
    { command: '/road split', label: '将选中的道路切分为两段', description: '将选中的道路切分为两段' },
    { command: '/road reverse', label: '反转选中道路的方向', description: '反转选中道路的方向' },
    { command: '/road mirror', label: '镜像选中道路的车道布局', description: '镜像选中道路的车道布局' },
    { command: '/lane add [side] [type]', label: '为选中道路添加车道', description: '为选中道路添加车道' },
    { command: '/lane delete [side]', label: '删除选中道路的车道', description: '删除选中道路的车道' },
    { command: '/lane width <meters>', label: '修改选中道路的车道宽度', description: '修改选中道路的车道宽度' },
    { command: '/junction create', label: '创建一个路口', description: '创建一个路口' },
    { command: '/signal add', label: '添加交通信号灯', description: '添加交通信号灯' },
    { command: '/marking add', label: '添加道路地面标线', description: '添加道路地面标线' },
    { command: '/help', label: '帮助', description: '显示可用命令列表' },
  ];
}

function getDefaultConfig(): IntentsConfigFile {
  return {
    version: 1,
    intents: [
      {
        action: 'addRoad',
        keywords: ['添加道路', '创建道路', '新建道路', '画道路', '添加一条路', '创建一条路'],
        synonyms: { '添加': ['加', '创建', '新建', '画', '生成', '建'], '道路': ['路', '公路', '马路', '街道'] },
        paramPatterns: {
          length: { patterns: ['(\\d+(?:\\.\\d+)?)\\s*(?:米|m|M|米长)'], type: 'number', default: 100 },
          lanes: { patterns: ['(\\d+)\\s*车道'], type: 'number', default: 2 },
          bidirectional: { patterns: ['双向'], type: 'boolean', default: false },
          laneWidth: { patterns: ['(\\d+(?:\\.\\d+)?)\\s*(?:米|m)\\s*宽'], type: 'number', default: 3.5 },
        },
        requiresSelection: false,
        priority: 10,
      },
      {
        action: 'removeRoad',
        keywords: ['删除道路', '删掉道路', '移除道路'],
        synonyms: { '删除': ['删掉', '移除', '去掉', '干掉'], '道路': ['路', '这条路', '选中的路'] },
        paramPatterns: {},
        requiresSelection: true,
        priority: 8,
      },
      {
        action: 'splitRoad',
        keywords: ['切分道路', '分割道路', '切开道路', '切割道路'],
        synonyms: { '切分': ['分割', '切开', '切割', '拆分'], '道路': ['路', '这条路'] },
        paramPatterns: {},
        requiresSelection: true,
        priority: 8,
      },
      {
        action: 'reverseRoad',
        keywords: ['反转道路', '翻转道路'],
        synonyms: { '反转': ['翻转', '调头', '掉头', '倒转'], '道路': ['路', '这条路', '方向'] },
        paramPatterns: {},
        requiresSelection: true,
        priority: 8,
      },
      {
        action: 'mirrorRoad',
        keywords: ['镜像道路', '镜像车道'],
        synonyms: { '镜像': ['对称'], '道路': ['路', '这条路', '车道布局'] },
        paramPatterns: {},
        requiresSelection: true,
        priority: 8,
      },
      {
        action: 'addLane',
        keywords: ['添加车道', '加车道', '增加车道'],
        synonyms: { '添加': ['加', '增加', '补', '新增'], '车道': ['行车道'] },
        paramPatterns: {
          side: { patterns: ['(左|左侧|左边)', '(右|右侧|右边)'], type: 'enum', mapping: { '左': 'left', '左侧': 'left', '左边': 'left', '右': 'right', '右侧': 'right', '右边': 'right' }, default: 'right' },
          type: { patterns: ['(driving|turning|biking|walking|行车|转弯|自行车|人行)'], type: 'enum', mapping: { '行车': 'driving', '转弯': 'turning', '自行车': 'biking', '人行': 'walking', driving: 'driving', turning: 'turning', biking: 'biking', walking: 'walking' } },
        },
        requiresSelection: true,
        priority: 5,
      },
      {
        action: 'removeLane',
        keywords: ['删除车道', '去掉车道', '移除车道'],
        synonyms: { '删除': ['去掉', '移除', '删掉', '减少'], '车道': ['行车道'] },
        paramPatterns: {
          side: { patterns: ['(左|左侧|左边)', '(右|右侧|右边)'], type: 'enum', mapping: { '左': 'left', '左侧': 'left', '左边': 'left', '右': 'right', '右侧': 'right', '右边': 'right' }, default: 'right' },
        },
        requiresSelection: true,
        priority: 5,
      },
      {
        action: 'updateLaneWidth',
        keywords: ['车道宽度', '修改车道宽', '调整车道宽'],
        synonyms: { '修改': ['改', '调整', '设置', '设为', '改成', '调为'], '宽度': ['宽'] },
        paramPatterns: {
          width: { patterns: ['(\\d+(?:\\.\\d+)?)\\s*(?:米|m|M)'], type: 'number', default: 3.5 },
        },
        requiresSelection: true,
        priority: 6,
      },
      {
        action: 'createJunction',
        keywords: ['创建路口', '建路口', '添加路口'],
        synonyms: { '创建': ['建', '添加', '新建'], '路口': ['交叉口', '十字路口'] },
        paramPatterns: {},
        requiresSelection: false,
        priority: 7,
      },
      {
        action: 'addSignal',
        keywords: ['添加信号灯', '加信号灯'],
        synonyms: { '添加': ['加', '放置', '安装'], '信号灯': ['红绿灯', '交通灯'] },
        paramPatterns: {},
        requiresSelection: false,
        priority: 7,
      },
      {
        action: 'addRoadMark',
        keywords: ['添加标线', '加标线', '添加地面标线'],
        synonyms: { '添加': ['加', '画', '绘制'], '标线': ['地面标线', '道路标线', '车道线'] },
        paramPatterns: {},
        requiresSelection: false,
        priority: 7,
      },
    ],
    slashCommands: [
      { pattern: '/road add', action: 'addRoad', paramHint: '[length]' },
      { pattern: '/road delete', action: 'removeRoad' },
      { pattern: '/road split', action: 'splitRoad' },
      { pattern: '/road reverse', action: 'reverseRoad' },
      { pattern: '/road mirror', action: 'mirrorRoad' },
      { pattern: '/lane add', action: 'addLane', paramHint: '[side] [type]' },
      { pattern: '/lane delete', action: 'removeLane', paramHint: '[side]' },
      { pattern: '/lane width', action: 'updateLaneWidth', paramHint: '<meters>' },
      { pattern: '/junction create', action: 'createJunction' },
      { pattern: '/signal add', action: 'addSignal' },
      { pattern: '/marking add', action: 'addRoadMark' },
      { pattern: '/help', action: 'help' },
    ],
  };
}
