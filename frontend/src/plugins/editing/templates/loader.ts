/**
 * Template Catalog Loader
 *
 * Loads the default built-in catalog and merges with any externally
 * contributed catalogs (e.g. from plugins or user config files).
 *
 * Validation ensures all required fields are present and values are
 * within expected ranges before the catalog is used.
 */
import type { TemplateCatalog, RoadTemplateConfig, JunctionTemplateConfig, SignalTemplateConfig, MarkingTemplateConfig, LaneConfig, MarkConfig } from './schema';
import defaultCatalog from './defaultCatalog';

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_LANE_TYPES = new Set([
  'Driving', 'Shoulder', 'Sidewalk', 'Parking', 'Median', 'Border', 'Stop', 'Biking', 'None',
]);

const VALID_MARK_TYPES = new Set([
  'Solid', 'Broken', 'SolidSolid', 'SolidBroken', 'BrokenSolid', 'BrokenBroken',
  'None', 'Curb', 'Grass', 'Botts',
]);

const VALID_MARK_COLORS = new Set(['Standard', 'Yellow', 'Blue', 'Green', 'Red']);

const VALID_TOPOLOGIES = new Set(['T', 'Cross', 'Radial', 'Roundabout']);

function validateMark(mark: MarkConfig, path: string): string[] {
  const errors: string[] = [];
  if (!VALID_MARK_TYPES.has(mark.type)) {
    errors.push(`${path}.type: unknown mark type '${mark.type}'`);
  }
  if (mark.color && !VALID_MARK_COLORS.has(mark.color)) {
    errors.push(`${path}.color: unknown color '${mark.color}'`);
  }
  if (mark.width !== undefined && mark.width < 0) {
    errors.push(`${path}.width: must be >= 0`);
  }
  return errors;
}

function validateLane(lane: LaneConfig, path: string): string[] {
  const errors: string[] = [];
  if (!VALID_LANE_TYPES.has(lane.laneType)) {
    errors.push(`${path}.laneType: unknown lane type '${lane.laneType}'`);
  }
  if (lane.width <= 0) {
    errors.push(`${path}.width: must be > 0`);
  }
  if (lane.mark) {
    errors.push(...validateMark(lane.mark, `${path}.mark`));
  }
  return errors;
}

function validateRoad(road: RoadTemplateConfig, idx: number): string[] {
  const path = `roads[${idx}]`;
  const errors: string[] = [];
  if (!road.id) errors.push(`${path}.id: required`);
  if (!road.labelKey) errors.push(`${path}.labelKey: required`);
  if (road.length !== undefined && road.length <= 0) errors.push(`${path}.length: must be > 0`);
  road.left.forEach((l, i) => errors.push(...validateLane(l, `${path}.left[${i}]`)));
  road.right.forEach((l, i) => errors.push(...validateLane(l, `${path}.right[${i}]`)));
  return errors;
}

function validateJunction(jct: JunctionTemplateConfig, idx: number): string[] {
  const path = `junctions[${idx}]`;
  const errors: string[] = [];
  if (!jct.id) errors.push(`${path}.id: required`);
  if (!jct.labelKey) errors.push(`${path}.labelKey: required`);
  if (!VALID_TOPOLOGIES.has(jct.topology)) errors.push(`${path}.topology: unknown '${jct.topology}'`);
  if (jct.armLength <= 0) errors.push(`${path}.armLength: must be > 0`);
  if (jct.armCount !== undefined && jct.armCount < 3) errors.push(`${path}.armCount: must be >= 3`);
  if (jct.armSection) {
    jct.armSection.left.forEach((l, i) => errors.push(...validateLane(l, `${path}.armSection.left[${i}]`)));
    jct.armSection.right.forEach((l, i) => errors.push(...validateLane(l, `${path}.armSection.right[${i}]`)));
  }
  return errors;
}

function validateSignal(sig: SignalTemplateConfig, idx: number): string[] {
  const path = `signals[${idx}]`;
  const errors: string[] = [];
  if (!sig.id) errors.push(`${path}.id: required`);
  if (!sig.signalType) errors.push(`${path}.signalType: required`);
  return errors;
}

function validateMarking(mark: MarkingTemplateConfig, idx: number): string[] {
  const path = `markings[${idx}]`;
  const errors: string[] = [];
  if (!mark.id) errors.push(`${path}.id: required`);
  if (!mark.mark) errors.push(`${path}.mark: required`);
  else errors.push(...validateMark(mark.mark, `${path}.mark`));
  return errors;
}

/** Validate a complete catalog. Returns an array of error strings (empty = valid). */
export function validateCatalog(catalog: TemplateCatalog): string[] {
  const errors: string[] = [];
  catalog.roads.forEach((r, i) => errors.push(...validateRoad(r, i)));
  catalog.junctions.forEach((j, i) => errors.push(...validateJunction(j, i)));
  catalog.signals.forEach((s, i) => errors.push(...validateSignal(s, i)));
  catalog.markings.forEach((m, i) => errors.push(...validateMarking(m, i)));
  return errors;
}

// ── Catalog merging ──────────────────────────────────────────────────────────

/** Merge two catalogs. Items from `extra` are appended; duplicates (by id) are skipped. */
export function mergeCatalogs(base: TemplateCatalog, extra: TemplateCatalog): TemplateCatalog {
  const existingIds = new Set([
    ...base.roads.map((r) => r.id),
    ...base.junctions.map((j) => j.id),
    ...base.signals.map((s) => s.id),
    ...base.markings.map((m) => m.id),
    ...(base.objects ?? []).map((o) => o.id),
    ...(base.signs ?? []).map((s) => s.id),
  ]);

  return {
    version: base.version,
    roads: [...base.roads, ...extra.roads.filter((r) => !existingIds.has(r.id))],
    junctions: [...base.junctions, ...extra.junctions.filter((j) => !existingIds.has(j.id))],
    signals: [...base.signals, ...extra.signals.filter((s) => !existingIds.has(s.id))],
    markings: [...base.markings, ...extra.markings.filter((m) => !existingIds.has(m.id))],
    objects: [...(base.objects ?? []), ...(extra.objects ?? []).filter((o) => !existingIds.has(o.id))],
    signs: [...(base.signs ?? []), ...(extra.signs ?? []).filter((s) => !existingIds.has(s.id))],
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * Load the full template catalog.
 *
 * Returns the built-in default catalog. In the future this can be extended
 * to merge user-configured or plugin-contributed catalogs.
 */
export function loadCatalog(): TemplateCatalog {
  return defaultCatalog;
}

/**
 * Parse and validate an external catalog from a raw object (e.g. parsed JSON).
 * Returns the catalog if valid, or throws with validation errors.
 */
export function parseExternalCatalog(raw: unknown): TemplateCatalog {
  const obj = raw as TemplateCatalog;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid catalog: expected an object');
  }
  const catalog: TemplateCatalog = {
    version: obj.version ?? '0.0.0',
    roads: Array.isArray(obj.roads) ? obj.roads : [],
    junctions: Array.isArray(obj.junctions) ? obj.junctions : [],
    signals: Array.isArray(obj.signals) ? obj.signals : [],
    markings: Array.isArray(obj.markings) ? obj.markings : [],
    objects: Array.isArray(obj.objects) ? obj.objects : [],
    signs: Array.isArray(obj.signs) ? obj.signs : [],
  };
  const errors = validateCatalog(catalog);
  if (errors.length > 0) {
    throw new Error(`Catalog validation failed:\n${errors.join('\n')}`);
  }
  return catalog;
}
