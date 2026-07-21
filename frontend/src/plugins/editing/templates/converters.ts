/**
 * Template converters — transform template configs into domain objects.
 *
 * Pure functions with no coupling to junction/roundabout logic.
 */

import type { RoadSignal, RoadMark, RoadObjectItem } from '../../../services/platform';
import type {
  SignalTemplateConfig, MarkingTemplateConfig,
  RoadObjectTemplateConfig, SignTemplateConfig,
} from './schema';
import { genId, markConfigToRoadMark } from './engine';

export function buildSignalFromConfig(config: SignalTemplateConfig): RoadSignal {
  return {
    id: genId(),
    name: '',
    s: 0,
    t: 0,
    z_offset: 0,
    h_offset: 0,
    width: config.width ?? 0.8,
    height: config.height ?? 0.8,
    signal_type: config.signalType,
    signal_subtype: config.signalSubtype ?? '-1',
    value: null,
    orientation: '+',
    is_dynamic: false,
  };
}

export function buildMarkFromConfig(config: MarkingTemplateConfig): RoadMark {
  return markConfigToRoadMark(config.mark);
}

export function buildRoadObjectFromConfig(
  config: RoadObjectTemplateConfig,
  s: number,
  t: number,
  hdg = 0,
): RoadObjectItem {
  return {
    id: genId(),
    object_type: config.objectType,
    name: '',
    position: { x: s, y: t, z: 0.1, id: null },
    orientation: hdg,
    hdg,
    width: config.defaultWidth ?? 1.0,
    height: config.defaultHeight ?? 0.5,
    length: config.defaultLength ?? 1.0,
    corners: [],
    validity: null,
  };
}

export function buildSignFromConfig(
  config: SignTemplateConfig,
  s: number,
  t: number,
  hdg = 0,
): RoadObjectItem {
  return {
    id: genId(),
    object_type: config.objectType,
    name: '',
    position: { x: s, y: t, z: 0.1, id: null },
    orientation: hdg,
    hdg,
    width: config.defaultWidth ?? 1.0,
    height: config.defaultHeight ?? 3.0,
    length: config.defaultWidth ?? 1.0,
    corners: [],
    validity: null,
  };
}
