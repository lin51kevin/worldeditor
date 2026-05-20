import { useProjectStore } from '../../../../stores/projectStore';
import type { ParsedIntent, RoadActionType } from './types';

export interface ActionResult {
  success: boolean;
  description: string;
  error?: string;
}

const ROAD_ACTIONS = new Set<RoadActionType>([
  'addRoad', 'removeRoad', 'splitRoad', 'reverseRoad', 'mirrorRoad',
  'addLane', 'removeLane', 'updateLaneWidth',
]);

function getSelectedRoadId(): string | null {
  return useProjectStore.getState().selectedRoadId;
}

function requireSelectedRoad(): ActionResult | null {
  const id = getSelectedRoadId();
  if (!id) {
    return { success: false, description: '', error: '请先选中一条道路' };
  }
  return null;
}

// Supported actions that need a selected road
const NEED_SELECTION: RoadActionType[] = [
  'removeRoad', 'splitRoad', 'reverseRoad', 'mirrorRoad',
  'addLane', 'removeLane', 'updateLaneWidth',
];

const HELP_TEXT = `🔧 WorldEditor AI Copilot 帮助

可用操作：
• 添加道路 - "添加一条道路"
• 删除道路 - "删除选中的道路"
• 反转道路 - "反转道路方向"
• 镜像道路 - "镜像道路车道"
• 切分道路 - "在中间切分道路"
• 添加车道 - "添加右侧车道"
• 删除车道 - "删除最外侧车道"
• 修改车道宽度 - "车道宽度改为4米"
• 帮助 - "帮助"`;

export async function executeIntent(intent: ParsedIntent): Promise<ActionResult> {
  const { action, params } = intent;

  // Non-action types
  if (action === 'help') {
    return { success: true, description: HELP_TEXT };
  }
  if (action === 'question') {
    return { success: true, description: '请使用 AI 对话面板进行提问，我可以回答关于 OpenDRIVE、道路设计等问题。' };
  }

  // Check supported
  if (!ROAD_ACTIONS.has(action)) {
    return { success: false, description: '', error: `不支持的操作: ${action}` };
  }

  // Check selection for actions that need it
  if (NEED_SELECTION.includes(action)) {
    const err = requireSelectedRoad();
    if (err) return err;
  }

  const store = useProjectStore.getState();
  const selectedId = store.selectedRoadId;

  switch (action) {
    case 'addRoad': {
      const id = `Road-${Date.now()}`;
      const length = params.length ? Number(params.length) : 100;
      const totalLanes = params.lanes ? Number(params.lanes) : 2;
      const bidirectional = params.bidirectional === true;
      const laneWidth = params.laneWidth ? Number(params.laneWidth) : 3.5;

      // Determine lane distribution
      let leftCount: number;
      let rightCount: number;
      if (bidirectional) {
        // Bidirectional: split lanes evenly left and right
        leftCount = Math.floor(totalLanes / 2);
        rightCount = Math.ceil(totalLanes / 2);
      } else {
        // Unidirectional: all lanes on right side
        leftCount = 0;
        rightCount = totalLanes;
      }

      const makeLane = (laneId: number, w: number) => ({
        id: laneId, lane_type: 'driving', level: 0,
        width: [{ s_offset: 0, a: w, b: 0, c: 0, d: 0 }],
        road_marks: [], borders: [],
        link: { predecessor: null, successor: null },
      });

      const leftLanes = Array.from({ length: leftCount }, (_, i) => makeLane(i + 1, laneWidth));
      const rightLanes = Array.from({ length: rightCount }, (_, i) => makeLane(-(i + 1), laneWidth));

      const newRoad = {
        id,
        name: id,
        length,
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length, geo_type: 'Line' as const }],
        lane_sections: [{
          s: 0, single_side: !bidirectional && leftCount === 0,
          left: leftLanes,
          center: [{ id: 0, lane_type: 'none', level: 0, width: [], road_marks: [], borders: [], link: { predecessor: null, successor: null } }],
          right: rightLanes,
        }],
        elevation_profile: [],
        link: { predecessor: null, successor: null },
        objects: [],
        signals: [],
      };
      store.addRoad(newRoad as any);

      // Build description
      const dirText = bidirectional ? '双向' : '单向';
      return { success: true, description: `已添加${dirText}${totalLanes}车道、${length}米长的道路 ${id}` };
    }

    case 'removeRoad':
      store.removeRoad(selectedId!);
      return { success: true, description: `已删除道路 ${selectedId}` };

    case 'reverseRoad':
      store.reverseRoad(selectedId!);
      return { success: true, description: `已反转道路 ${selectedId}` };

    case 'mirrorRoad':
      store.mirrorRoad(selectedId!);
      return { success: true, description: `已镜像道路 ${selectedId}` };

    case 'splitRoad':
      store.executePluginCommand(`切分道路 ${selectedId}`, (project) => {
        const road = project.roads.find((r) => r.id === selectedId);
        if (!road) return project;
        const mid = road.length / 2;
        // Simple split: two roads with halved length
        const road1 = {
          ...JSON.parse(JSON.stringify(road)),
          id: `${selectedId}_a`,
          name: `${selectedId}_a`,
          length: mid,
        };
        const road2 = {
          ...JSON.parse(JSON.stringify(road)),
          id: `${selectedId}_b`,
          name: `${selectedId}_b`,
          length: mid,
        };
        return {
          ...project,
          roads: project.roads.map((r) => (r.id === selectedId ? null : r)).filter(Boolean).concat([road1, road2]) as any[],
        };
      });
      return { success: true, description: `已将道路 ${selectedId} 切分为两段` };

    case 'addLane': {
      const side = (params.side as 'left' | 'right') ?? 'right';
      store.addLane(selectedId!, 0, side);
      const sideText = side === 'left' ? '左侧' : '右侧';
      return { success: true, description: `已为道路 ${selectedId} 添加${sideText}车道` };
    }

    case 'removeLane': {
      const road = store.project.roads.find((r) => r.id === selectedId);
      if (!road || road.lane_sections.length === 0) {
        return { success: false, description: '', error: '选中的道路没有车道段' };
      }
      const section = road.lane_sections[0]!;
      // Remove outermost right lane by default
      const side = (params.side as 'left' | 'right') ?? 'right';
      const lanes = section[side];
      if (lanes.length === 0) {
        return { success: false, description: '', error: `${side === 'left' ? '左' : '右'}侧没有车道可删除` };
      }
      const outermost = lanes.reduce((a, b) =>
        Math.abs(a.id) > Math.abs(b.id) ? a : b
      );
      store.removeLane(selectedId!, 0, side, outermost.id);
      return { success: true, description: `已从道路 ${selectedId} 删除${side === 'left' ? '左' : '右'}侧车道` };
    }

    case 'updateLaneWidth': {
      const width = params.width ?? 3.5;
      const side = (params.side as 'left' | 'right') ?? 'right';
      const laneId = params.laneId ?? -1;
      store.updateLaneWidth(selectedId!, 0, side, laneId, {
        s_offset: 0, a: width, b: 0, c: 0, d: 0,
      });
      return { success: true, description: `已将道路 ${selectedId} 车道宽度调整为 ${width}m` };
    }

    default:
      return { success: false, description: '', error: `不支持的操作: ${action}` };
  }
}
