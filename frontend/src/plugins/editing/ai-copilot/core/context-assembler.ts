import { useProjectStore } from '../../../../stores/projectStore';
import type { Road, Lane } from '../../../../services/platform';

export interface ProjectContext {
  roadCount: number;
  junctionCount: number;
  selectedElements: string[];
  roadsSummary: Array<{ id: string; name: string; length: number; laneCount: number }>;
  selectedRoadDetail?: {
    id: string;
    name: string;
    length: number;
    leftLanes: Array<{ id: number; type: string; width: number }>;
    rightLanes: Array<{ id: number; type: string; width: number }>;
  };
}

function getLaneWidth(lane: Lane): number {
  if (lane.width.length === 0) return 0;
  // Width at s=0: a + b*0 + c*0 + d*0 = a
  return lane.width[0]!.a;
}

function summarizeRoad(road: Road): { id: string; name: string; length: number; laneCount: number } {
  const laneCount = road.lane_sections.reduce(
    (sum, ls) => sum + ls.left.length + ls.center.length + ls.right.length,
    0,
  );
  return { id: road.id, name: road.name, length: road.length, laneCount };
}

export function assembleContext(): ProjectContext {
  const state = useProjectStore.getState();
  const { project, selectedRoadId, selectedJunctionId, selectedRoadIds, selectedJunctionIds } = state;

  const selectedElements: string[] = [];
  if (selectedRoadId) selectedElements.push(selectedRoadId);
  if (selectedJunctionId) selectedElements.push(selectedJunctionId);
  selectedRoadIds.forEach((id) => { if (!selectedElements.includes(id)) selectedElements.push(id); });
  selectedJunctionIds.forEach((id) => { if (!selectedElements.includes(id)) selectedElements.push(id); });

  const roadsSummary = project.roads.map(summarizeRoad);

  let selectedRoadDetail: ProjectContext['selectedRoadDetail'];
  if (selectedRoadId) {
    const road = project.roads.find((r) => r.id === selectedRoadId);
    if (road) {
      const firstSection = road.lane_sections[0];
      const leftLanes = firstSection
        ? firstSection.left.map((l) => ({ id: l.id, type: l.lane_type, width: getLaneWidth(l) }))
        : [];
      const rightLanes = firstSection
        ? firstSection.right.map((l) => ({ id: l.id, type: l.lane_type, width: getLaneWidth(l) }))
        : [];
      selectedRoadDetail = { id: road.id, name: road.name, length: road.length, leftLanes, rightLanes };
    }
  }

  return { roadCount: project.roads.length, junctionCount: project.junctions.length, selectedElements, roadsSummary, selectedRoadDetail };
}

export function contextToPrompt(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push('当前项目状态：');
  lines.push(`- 道路数量：${ctx.roadCount}`);
  lines.push(`- 路口数量：${ctx.junctionCount}`);
  if (ctx.selectedElements.length > 0) {
    lines.push(`- 选中元素：${ctx.selectedElements.join(', ')}`);
  } else {
    lines.push('- 选中元素：无');
  }

  if (ctx.selectedRoadDetail) {
    const d = ctx.selectedRoadDetail;
    lines.push('');
    lines.push('选中道路详情：');
    lines.push(`${d.id} (长度: ${d.length}m)`);
    lines.push(`  左侧车道：${d.leftLanes.map((l) => `[${l.id}:${l.type}(${l.width}m)]`).join(' ') || '无'}`);
    lines.push(`  右侧车道：${d.rightLanes.map((l) => `[${l.id}:${l.type}(${l.width}m)]`).join(' ') || '无'}`);
  }

  lines.push('');
  lines.push('可用操作：addRoad, removeRoad, splitRoad, addLane, removeLane, updateLaneWidth...');

  return lines.join('\n');
}
