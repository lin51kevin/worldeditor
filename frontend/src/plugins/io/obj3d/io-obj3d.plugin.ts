/**
 * plugin-io-obj3d: Wavefront OBJ 3D mesh export plugin.
 * Export only — roads are tessellated into triangulated quad-strips.
 */
import type { Project, Road } from '../../../services/platform';
import { saveExport } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

function computeRoadWidth(road: Road): number {
  const ls = road.lane_sections?.[0];
  if (ls) {
    const leftCount = ls.left?.length ?? 0;
    const rightCount = ls.right?.length ?? 0;
    if (leftCount + rightCount > 0) {
      const firstLaneWidth = ls.left?.[0]?.width?.[0]?.a ?? ls.right?.[0]?.width?.[0]?.a ?? 3.5;
      return (leftCount + rightCount) * firstLaneWidth;
    }
  }
  return 3.5;
}

/** Extract the actual export logic for testability. */
export function generateObjContent(project: Project): string {
  const lines = [
    '# WorldEditor — OBJ Export',
    `# Roads: ${project.roads.length}`,
    `# Generated: ${new Date().toISOString()}`,
  ];
  let vOffset = 0;

  for (const road of project.roads) {
    const geo = road.plan_view;
    if (geo.length === 0) continue;

    const hw = computeRoadWidth(road) / 2;

    for (let i = 0; i < geo.length; i++) {
      const g = geo[i];
      const nextG = geo[i + 1];

      const sx = g!.x ?? 0;
      const sy = g!.y ?? 0;
      const shdg = g!.hdg ?? 0;

      // End point: next geometry's start, or extrapolate from current
      let ex: number, ey: number;
      if (nextG) {
        ex = nextG.x ?? sx + g!.length * Math.cos(shdg);
        ey = nextG.y ?? sy + g!.length * Math.sin(shdg);
      } else {
        ex = sx + g!.length * Math.cos(shdg);
        ey = sy + g!.length * Math.sin(shdg);
      }

      // Start perpendicular
      const perpStart = shdg + Math.PI / 2;
      const sLx = sx + hw * Math.cos(perpStart);
      const sLy = sy + hw * Math.sin(perpStart);
      const sRx = sx - hw * Math.cos(perpStart);
      const sRy = sy - hw * Math.sin(perpStart);

      // End heading & perpendicular
      const eHdg = Math.atan2(ey - sy, ex - sx);
      const perpEnd = eHdg + Math.PI / 2;
      const eLx = ex + hw * Math.cos(perpEnd);
      const eLy = ey + hw * Math.sin(perpEnd);
      const eRx = ex - hw * Math.cos(perpEnd);
      const eRy = ey - hw * Math.sin(perpEnd);

      lines.push(`v ${sLx} ${sLy} 0`);
      lines.push(`v ${sRx} ${sRy} 0`);
      lines.push(`v ${eLx} ${eLy} 0`);
      lines.push(`v ${eRx} ${eRy} 0`);

      const b = vOffset + 1;
      lines.push(`f ${b} ${b + 1} ${b + 2}`);
      lines.push(`f ${b + 1} ${b + 3} ${b + 2}`);
      vOffset += 4;
    }
  }

  return lines.join('\n');
}

function exportToObj(project: Project): Promise<void> {
  const content = generateObjContent(project);
  const blob = new Blob([content], { type: 'model/obj' });
  return saveExport(blob, `${project.name || 'export'}.obj`, [{ name: 'Wavefront OBJ', extensions: ['obj'] }]);
}

export const mountIoObj3dPlugin = createIOPlugin({
  pluginId: 'io-obj3d-export',
  exporter: {
    formatName: 'Wavefront OBJ 3D',
    onExport: exportToObj,
  },
});
