/**
 * plugin-io-obj3d: Wavefront OBJ 3D mesh export plugin.
 * Export only — roads are tessellated into triangulated quad-strips.
 */
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { Project } from '../services/platform';
import { downloadBlob } from '../utils/download';

const PLUGIN_ID = 'io-obj3d';

function exportToObj(project: Project): Promise<void> {
  const lines = ['# WorldEditor Next — OBJ Export', `# Roads: ${project.roads.length}`];
  let vOffset = 0;
  for (const road of project.roads) {
    const g = road.plan_view[0];
    if (!g) continue;
    const hw = 3.5;
    const perp = g.hdg + Math.PI / 2;
    const lx = g.x + hw * Math.cos(perp);
    const ly = g.y + hw * Math.sin(perp);
    const rx = g.x - hw * Math.cos(perp);
    const ry = g.y - hw * Math.sin(perp);
    const ex = g.x + road.length * Math.cos(g.hdg);
    const ey = g.y + road.length * Math.sin(g.hdg);
    const elx = ex + hw * Math.cos(perp);
    const ely = ey + hw * Math.sin(perp);
    const erx = ex - hw * Math.cos(perp);
    const ery = ey - hw * Math.sin(perp);
    lines.push(`v ${lx} ${ly} 0`);
    lines.push(`v ${rx} ${ry} 0`);
    lines.push(`v ${elx} ${ely} 0`);
    lines.push(`v ${erx} ${ery} 0`);
    const b = vOffset + 1;
    lines.push(`f ${b} ${b + 1} ${b + 2}`);
    lines.push(`f ${b + 1} ${b + 3} ${b + 2}`);
    vOffset += 4;
  }
  const blob = new Blob([lines.join('\n')], { type: 'model/obj' });
  downloadBlob(blob, `${project.name || 'export'}.obj`);
  return Promise.resolve();
}

export function mountIoObj3dPlugin(): () => void {
  const { registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'Wavefront OBJ 3D',
    onExport: exportToObj,
  });
  return () => unregisterPlugin(PLUGIN_ID);
}
