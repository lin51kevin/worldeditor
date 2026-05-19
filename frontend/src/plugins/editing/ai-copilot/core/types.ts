// 道路操作相关类型
export type RoadActionType =
  | 'addRoad' | 'removeRoad' | 'splitRoad' | 'reverseRoad' | 'mirrorRoad'
  | 'addLane' | 'removeLane' | 'updateLaneWidth' | 'updateLaneType'
  | 'createJunction' | 'removeJunction'
  | 'addSignal' | 'addRoadMark' | 'addObject'
  | 'selectRoad' | 'selectLane'
  | 'explain' | 'help' | 'question';  // 非操作类

export interface ParsedIntent {
  action: RoadActionType;
  params: Record<string, any>;
  confidence: number;
  rawInput: string;
}

export type ApplyMode = 'manual' | 'auto';
