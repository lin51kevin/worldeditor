/**
 * io-csv — external CSV coordinate import/export plugin.
 *
 * Demonstrates the externalised plugin architecture: this file is bundled by
 * `scripts/build-plugins.mjs` into `plugins/io-csv/dist/index.js` (IIFE) and
 * loaded at runtime on the Tauri desktop build. It is fully self-contained —
 * the only host coupling is via the `PluginContext` (importer/exporter
 * registration and `saveTextFile`).
 *
 * Import: parses rows as road centre-lines (x,y,hdg[,id] columns).
 * Export: serialises road plan-view geometry as CSV via the host save API.
 */

import type { Project } from '../../services/platform';
import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'io-csv';

function parseCsvToProject(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

  if (lines.length <= 1) {
    return Promise.reject(new Error('CSV file has no data rows (only header or empty)'));
  }

  const dataLines = lines.slice(1); // skip header
  const errors: string[] = [];

  const roads = dataLines.map((line, i) => {
    const parts = line.split(',').map((s) => s.trim());
    const [xStr = '0', yStr = '0', hdgStr = '0', id] = parts;

    const x = parseFloat(xStr);
    const y = parseFloat(yStr);
    const hdg = parseFloat(hdgStr);

    if (Number.isNaN(x) || Number.isNaN(y)) {
      errors.push(`Line ${i + 2}: invalid coordinates (x="${xStr}", y="${yStr}")`);
    }

    return {
      id: id || `csv_${i + 1}`,
      name: '',
      length: 10,
      junction_id: null,
      render_hidden: false,
      link: null,
      plan_view: [
        {
          s: 0,
          x: Number.isNaN(x) ? 0 : x,
          y: Number.isNaN(y) ? 0 : y,
          hdg: Number.isNaN(hdg) ? 0 : hdg,
          length: 10,
          geo_type: 'Line' as const,
        },
      ],
      elevation_profile: [],
      lane_sections: [],
      lane_offsets: [],
      lateral_profile: { superelevations: [], crossfalls: [] },
      bridges: [],
      tunnels: [],
      signals: [],
      objects: [],
    };
  });

  if (errors.length > 0) {
    console.warn(`[CSV Import] ${errors.length} warning(s):`, errors.join('; '));
  }

  return Promise.resolve({
    name: errors.length > 0 ? `CSV Import (${errors.length} warning(s))` : 'CSV Import',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  });
}

function serialiseProjectToCsv(project: Project): string {
  const lines = ['id,segment,x,y,hdg,length'];
  for (const road of project.roads) {
    if (road.plan_view.length === 0) continue;
    road.plan_view.forEach((g, idx) => {
      if (g) {
        lines.push(`${road.id},${idx},${g.x},${g.y},${g.hdg},${g.length}`);
      }
    });
  }
  return lines.join('\n');
}

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'CSV Coordinates',
    extensions: ['.csv', '.txt'],
    disabled: false,
    onImport: (content) => parseCsvToProject(content),
  });

  ctx.registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'CSV Coordinates',
    disabled: false,
    onExport: async (project) => {
      const csv = serialiseProjectToCsv(project);
      await ctx.saveTextFile(`${project.name || 'export'}.csv`, csv, ['csv']);
    },
  });
});
