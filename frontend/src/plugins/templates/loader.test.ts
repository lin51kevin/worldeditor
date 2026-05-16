import { describe, it, expect } from 'vitest';
import { validateCatalog, mergeCatalogs, parseExternalCatalog, loadCatalog } from './loader';
import type { TemplateCatalog } from './schema';

// ── loadCatalog ──────────────────────────────────────────────────────────────

describe('loadCatalog', () => {
  it('should return a catalog with all four sections', () => {
    const catalog = loadCatalog();
    expect(catalog.roads.length).toBeGreaterThan(0);
    expect(catalog.junctions.length).toBeGreaterThan(0);
    expect(catalog.signals.length).toBeGreaterThan(0);
    expect(catalog.markings.length).toBeGreaterThan(0);
  });

  it('should contain 7 road templates', () => {
    const catalog = loadCatalog();
    expect(catalog.roads).toHaveLength(7);
  });

  it('should contain 5 junction templates', () => {
    const catalog = loadCatalog();
    expect(catalog.junctions).toHaveLength(5);
  });

  it('should contain 8 signal templates', () => {
    const catalog = loadCatalog();
    expect(catalog.signals).toHaveLength(8);
  });

  it('should contain 6 marking templates', () => {
    const catalog = loadCatalog();
    expect(catalog.markings).toHaveLength(6);
  });

  it('should have version string', () => {
    const catalog = loadCatalog();
    expect(catalog.version).toBe('1.0.0');
  });
});

// ── validateCatalog ──────────────────────────────────────────────────────────

describe('validateCatalog', () => {
  it('should validate the default catalog without errors', () => {
    const catalog = loadCatalog();
    const errors = validateCatalog(catalog);
    expect(errors).toHaveLength(0);
  });

  it('should report missing road id', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: '', labelKey: 'test', icon: 'x', left: [], right: [{ laneType: 'Driving', width: 3.5 }] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('id: required'))).toBe(true);
  });

  it('should report invalid lane type', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: 'test', labelKey: 'test', icon: 'x', left: [{ laneType: 'InvalidType', width: 3.5 }], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('laneType'))).toBe(true);
  });

  it('should report invalid lane width', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: 'test', labelKey: 'test', icon: 'x', left: [], right: [{ laneType: 'Driving', width: -1 }] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('width: must be > 0'))).toBe(true);
  });

  it('should report invalid mark type', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: 'test', labelKey: 'test', icon: 'x', left: [{ laneType: 'Driving', width: 3.5, mark: { type: 'InvalidMark' } }], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('mark type'))).toBe(true);
  });

  it('should report invalid junction topology', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [],
      junctions: [{ id: 'test', labelKey: 'test', icon: 'x', topology: 'Invalid' as 'T', armLength: 80 }],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('topology'))).toBe(true);
  });

  it('should report invalid arm length', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [],
      junctions: [{ id: 'test', labelKey: 'test', icon: 'x', topology: 'T', armLength: -5 }],
      signals: [],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('armLength'))).toBe(true);
  });

  it('should report missing signal type', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [],
      junctions: [],
      signals: [{ id: 'test', labelKey: 'test', icon: 'x', signalType: '' }],
      markings: [],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('signalType'))).toBe(true);
  });

  it('should report missing marking mark', () => {
    const catalog: TemplateCatalog = {
      version: '1.0.0',
      roads: [],
      junctions: [],
      signals: [],
      markings: [{ id: 'test', labelKey: 'test', icon: 'x', mark: undefined as unknown as { type: string } }],
    };
    const errors = validateCatalog(catalog);
    expect(errors.some((e) => e.includes('mark: required'))).toBe(true);
  });
});

// ── mergeCatalogs ────────────────────────────────────────────────────────────

describe('mergeCatalogs', () => {
  const base: TemplateCatalog = {
    version: '1.0.0',
    roads: [{ id: 'road-a', labelKey: 'a', icon: 'A', left: [], right: [] }],
    junctions: [],
    signals: [],
    markings: [],
  };

  it('should append new items from extra', () => {
    const extra: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: 'road-b', labelKey: 'b', icon: 'B', left: [], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const merged = mergeCatalogs(base, extra);
    expect(merged.roads).toHaveLength(2);
  });

  it('should skip duplicate IDs', () => {
    const extra: TemplateCatalog = {
      version: '1.0.0',
      roads: [{ id: 'road-a', labelKey: 'duplicate', icon: 'D', left: [], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const merged = mergeCatalogs(base, extra);
    expect(merged.roads).toHaveLength(1);
    expect(merged.roads[0]!.labelKey).toBe('a'); // base wins
  });

  it('should preserve base version', () => {
    const extra: TemplateCatalog = { version: '2.0.0', roads: [], junctions: [], signals: [], markings: [] };
    const merged = mergeCatalogs(base, extra);
    expect(merged.version).toBe('1.0.0');
  });
});

// ── parseExternalCatalog ─────────────────────────────────────────────────────

describe('parseExternalCatalog', () => {
  it('should parse a valid catalog object', () => {
    const raw = {
      version: '1.0.0',
      roads: [{ id: 'ext:road', labelKey: 'ext.road', icon: 'E', left: [{ laneType: 'Driving', width: 3.5 }], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    const catalog = parseExternalCatalog(raw);
    expect(catalog.roads).toHaveLength(1);
  });

  it('should throw on invalid input', () => {
    expect(() => parseExternalCatalog(null)).toThrow('Invalid catalog');
  });

  it('should throw on validation errors', () => {
    const raw = {
      version: '1.0.0',
      roads: [{ id: '', labelKey: '', icon: '', left: [], right: [] }],
      junctions: [],
      signals: [],
      markings: [],
    };
    expect(() => parseExternalCatalog(raw)).toThrow('validation failed');
  });

  it('should handle missing arrays gracefully', () => {
    const raw = { version: '1.0.0' };
    const catalog = parseExternalCatalog(raw);
    expect(catalog.roads).toHaveLength(0);
    expect(catalog.junctions).toHaveLength(0);
  });
});
