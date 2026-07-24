/**
 * io-osm — external OpenStreetMap XML export plugin (export only).
 * Generates OSM XML from road network data. Pure logic, no WASM.
 */

import type { Project } from '../../services/platform';
import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-osm';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateOsmXml(project: Project): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="WorldEditor">\n';
  let nodeId = -1;
  const allWays: Array<{ roadId: string; length: number; nodes: number[] }> = [];

  for (const road of project.roads) {
    const geo = road.plan_view;
    if (geo.length === 0) continue;

    const roadNodes: number[] = [];
    const nodeCoords: Array<{ id: number; lat: number; lon: number }> = [];

    for (let i = 0; i < geo.length; i++) {
      const g = geo[i]!;
      const sx = g.x ?? 0;
      const sy = g.y ?? 0;

      if (i === 0) {
        const nId = nodeId--;
        roadNodes.push(nId);
        nodeCoords.push({ id: nId, lat: sy, lon: sx });
      }

      const nextG = geo[i + 1];
      let ex: number, ey: number;
      if (nextG) {
        ex = nextG.x ?? (sx + (g.length ?? 0) * Math.cos(g.hdg ?? 0));
        ey = nextG.y ?? (sy + (g.length ?? 0) * Math.sin(g.hdg ?? 0));
      } else {
        ex = sx + (g.length ?? 0) * Math.cos(g.hdg ?? 0);
        ey = sy + (g.length ?? 0) * Math.sin(g.hdg ?? 0);
      }
      const nId = nodeId--;
      roadNodes.push(nId);
      nodeCoords.push({ id: nId, lat: ey, lon: ex });
    }

    for (const nc of nodeCoords) {
      xml += `  <node id="${nc.id}" lat="${nc.lat}" lon="${nc.lon}"/>\n`;
    }
    allWays.push({ roadId: road.id, length: road.length, nodes: roadNodes });
  }

  let wayId = -1001;
  for (const way of allWays) {
    xml += `  <way id="${wayId--}">\n`;
    for (const nid of way.nodes) {
      xml += `    <nd ref="${nid}"/>\n`;
    }
    xml += `    <tag k="highway" v="residential"/>\n`;
    xml += `    <tag k="ref" v="${escapeXml(way.roadId)}"/>\n`;
    xml += `    <tag k="length" v="${way.length}"/>\n`;
    xml += `  </way>\n`;
  }

  xml += '</osm>\n';
  return xml;
}

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'OpenStreetMap XML',
    disabled: false,
    onExport: async (project) => {
      await ctx.saveTextFile(`${project.name || 'export'}.osm`, generateOsmXml(project), ['osm', 'xml']);
    },
  });
});
