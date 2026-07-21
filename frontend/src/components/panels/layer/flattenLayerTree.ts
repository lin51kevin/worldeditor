import type { Road, Junction } from '../../../services/platform';
import type { LaneSide } from '../../../utils/sceneGraph';
import { makeLaneSectionKey } from '../../../utils/sceneGraph';
import type { FlatLayerItem } from './virtualLayerTypes';

/**
 * Flatten the road/junction tree into a linear list for virtual rendering.
 * Only expands children when parent is expanded.
 * When `searchQuery` is provided, only matching children are included.
 */
export function flattenLayerTree(
  roads: Road[],
  junctions: Junction[],
  expandedRoads: Set<string>,
  expandedLaneSections: Set<string>,
  expandedRoadSignals: Set<string>,
  expandedRoadObjects: Set<string>,
  searchQuery?: string,
): FlatLayerItem[] {
  const items: FlatLayerItem[] = [];
  const q = (searchQuery ?? '').trim().toLowerCase();

  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]!;
    items.push({ type: 'road', roadId: road.id, roadIndex: i, depth: 0 });

    if (!expandedRoads.has(road.id)) continue;

    // Lane sections
    for (let si = 0; si < road.lane_sections.length; si++) {
      items.push({ type: 'laneSection', roadId: road.id, sectionIndex: si, depth: 1 });

      const sectionKey = makeLaneSectionKey(road.id, si);
      if (!expandedLaneSections.has(sectionKey)) continue;

      const section = road.lane_sections[si]!;
      for (const lane of section.left) {
        items.push({
          type: 'lane',
          roadId: road.id,
          sectionIndex: si,
          side: 'left' as LaneSide,
          laneId: lane.id,
          laneType: lane.lane_type,
          depth: 2,
        });
      }
      for (const lane of section.right) {
        items.push({
          type: 'lane',
          roadId: road.id,
          sectionIndex: si,
          side: 'right' as LaneSide,
          laneId: lane.id,
          laneType: lane.lane_type,
          depth: 2,
        });
      }
    }

    // Signals group
    const signals = road.signals ?? [];
    if (signals.length > 0) {
      // When searching, filter signals to only matching ones
      const visibleSignals = q
        ? signals.filter((s) =>
          s.id.toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q) ||
          s.signal_type.toLowerCase().includes(q) ||
          (s.signal_subtype || '').toLowerCase().includes(q),
        )
        : signals;

      if (visibleSignals.length > 0) {
        items.push({ type: 'signalGroup', roadId: road.id, count: visibleSignals.length, depth: 1 });

        if (expandedRoadSignals.has(road.id)) {
          for (const signal of visibleSignals) {
            const sigType = (signal.signal_subtype && signal.signal_subtype !== '-1')
              ? signal.signal_subtype
              : signal.signal_type;
            items.push({
              type: 'signal',
              roadId: road.id,
              signalId: signal.id,
              signalName: signal.name || '',
              signalType: sigType,
              depth: 2,
            });
          }
        }
      }
    }

    // Objects group
    const objects = road.objects ?? [];
    if (objects.length > 0) {
      // When searching, filter objects to only matching ones
      const visibleObjects = q
        ? objects.filter((o) => {
          const typeStr = typeof o.object_type === 'string' ? o.object_type : o.object_type.Custom;
          return o.id.toLowerCase().includes(q) ||
            (o.name || '').toLowerCase().includes(q) ||
            typeStr.toLowerCase().includes(q);
        })
        : objects;

      if (visibleObjects.length > 0) {
        items.push({ type: 'objectGroup', roadId: road.id, count: visibleObjects.length, depth: 1 });

        if (expandedRoadObjects.has(road.id)) {
          for (const obj of visibleObjects) {
            const typeStr = typeof obj.object_type === 'string' ? obj.object_type : obj.object_type.Custom;
            items.push({
              type: 'object',
              roadId: road.id,
              objectId: obj.id,
              objectName: obj.name || '',
              objectType: typeStr,
              depth: 2,
            });
          }
        }
      }
    }
  }

  // Junctions
  for (const junc of junctions) {
    items.push({ type: 'junction', junctionId: junc.id, depth: 0 });
  }

  return items;
}
