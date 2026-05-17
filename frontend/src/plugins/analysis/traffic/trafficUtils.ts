import type { Geometry, Project, Road, RoadSignal } from '../../../services/platform';

export interface TrafficPhaseSuggestion {
  id: string;
  label: string;
  roadIds: string[];
  signalIds: string[];
  cycleSeconds: number;
  greenSeconds: number;
  yellowSeconds: number;
  redSeconds: number;
}

export function autoDeploySignals(project: Project): Project {
  const roads = project.roads.map((road, index) => {
    if ((road.signals?.length ?? 0) > 0) {
      return road;
    }

    const signal: RoadSignal = {
      id: `sig_${road.id}`,
      name: `Signal ${index + 1}`,
      s: Math.max(road.length - 5, 0),
      t: 0,
      z_offset: 0,
      h_offset: 0,
      width: 0.4,
      height: 1.2,
      signal_type: 'traffic_light',
      signal_subtype: 'default',
      value: null,
      orientation: '+',
      is_dynamic: true,
    };

    return {
      ...road,
      signals: [signal],
    };
  });

  return {
    ...project,
    roads,
  };
}

export function computeTrafficPhases(project: Project): TrafficPhaseSuggestion[] {
  if (project.junctions.length > 0) {
    return project.junctions.map((junction, index) => {
      const roadIds = junction.connections.flatMap((connection) => [connection.incoming_road, connection.connecting_road]);
      const uniqueRoadIds = Array.from(new Set(roadIds));
      const signals = uniqueRoadIds.flatMap((roadId) => findSignals(project, roadId));
      const cycleSeconds = Math.max(40, uniqueRoadIds.length * 20);
      return {
        id: junction.id,
        label: junction.name || `Junction ${index + 1}`,
        roadIds: uniqueRoadIds,
        signalIds: signals.map((signal) => signal.id),
        cycleSeconds,
        greenSeconds: Math.max(15, Math.round(cycleSeconds * 0.5)),
        yellowSeconds: 3,
        redSeconds: Math.max(10, cycleSeconds - Math.max(15, Math.round(cycleSeconds * 0.5)) - 3),
      };
    });
  }

  return project.roads
    .filter((road) => (road.signals?.length ?? 0) > 0)
    .map((road, index) => ({
      id: road.id,
      label: road.name || `Road ${index + 1}`,
      roadIds: [road.id],
      signalIds: (road.signals ?? []).map((signal) => signal.id),
      cycleSeconds: 45,
      greenSeconds: 24,
      yellowSeconds: 3,
      redSeconds: 18,
    }));
}

export function importSumoNetwork(content: string | ArrayBuffer, fileName = 'sumo.net.xml'): Project {
  const xml = typeof content === 'string' ? content : new TextDecoder().decode(content);
  if (!xml.includes('<net')) {
    throw new Error('Invalid SUMO network: missing <net> root element');
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xml, 'application/xml');
  const parseError = documentNode.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid SUMO network XML: ${parseError.textContent?.trim() || 'parser error'}`);
  }
  const edges = Array.from(documentNode.querySelectorAll('edge')).filter((edge) => !edge.getAttribute('function'));
  const roads = edges
    .map((edge) => edgeToRoad(edge))
    .filter((road): road is Road => road !== null);

  return {
    name: fileName.replace(/\.[^.]+$/, ''),
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

export function exportSumoNetwork(project: Project): string {
  const edgeXml = project.roads.map((road, index) => {
    const shape = roadShape(road);
    return `  <edge id="${escapeXml(road.id)}" from="n${index}" to="n${index + 1}">\n    <lane id="${escapeXml(road.id)}_0" index="0" speed="13.89" length="${road.length.toFixed(3)}" shape="${escapeXml(shape)}"/>\n  </edge>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<net>\n${edgeXml}\n</net>\n`;
}

function findSignals(project: Project, roadId: string): RoadSignal[] {
  return project.roads.find((road) => road.id === roadId)?.signals ?? [];
}

function edgeToRoad(edge: Element): Road | null {
  const lane = edge.querySelector('lane');
  const shape = lane?.getAttribute('shape');
  if (!shape) {
    return null;
  }

  const points = shape
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [xStr, yStr] = token.split(',');
      return {
        x: Number.parseFloat(xStr ?? ''),
        y: Number.parseFloat(yStr ?? ''),
      };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (points.length < 2) {
    return null;
  }

  const geometries: Geometry[] = [];
  let s = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length <= Number.EPSILON) {
      continue;
    }
    geometries.push({
      s,
      x: start.x,
      y: start.y,
      hdg: Math.atan2(dy, dx),
      length,
      geo_type: 'Line',
    });
    s += length;
  }

  if (geometries.length === 0) {
    return null;
  }

  return {
    id: edge.getAttribute('id') || `edge_${Math.random().toString(36).slice(2, 8)}`,
    name: edge.getAttribute('id') || '',
    length: s,
    junction_id: null,
    render_hidden: false,
    link: null,
    plan_view: geometries,
    elevation_profile: [],
    lane_sections: [],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
  };
}

function roadShape(road: Road): string {
  const points: Array<{ x: number; y: number }> = [];
  road.plan_view.forEach((geometry, index) => {
    if (index === 0) {
      points.push({ x: geometry.x, y: geometry.y });
    }
    points.push({
      x: geometry.x + geometry.length * Math.cos(geometry.hdg),
      y: geometry.y + geometry.length * Math.sin(geometry.hdg),
    });
  });
  return points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(' ');
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}