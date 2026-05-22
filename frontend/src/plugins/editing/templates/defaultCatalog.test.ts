import { describe, expect, it } from 'vitest';
import catalog from './defaultCatalog';

describe('defaultCatalog', () => {
  it('exposes the expected catalog structure and section sizes', () => {
    expect(catalog.version).toBe('1.0.0');
    expect(catalog.roads).toHaveLength(7);
    expect(catalog.junctions).toHaveLength(8);
    expect(catalog.signals).toHaveLength(13);
    expect(catalog.markings).toHaveLength(8);
    expect(catalog.objects).toHaveLength(13);
    expect(catalog.signs).toHaveLength(5);
  });

  it('gives every template a unique id and required common fields', () => {
    const allTemplates = [
      ...catalog.roads,
      ...catalog.junctions,
      ...catalog.signals,
      ...catalog.markings,
      ...catalog.objects,
      ...catalog.signs,
    ];

    const ids = allTemplates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);

    allTemplates.forEach((template) => {
      expect(template.id).toMatch(/^tpl:/);
      expect(template.labelKey).toBeTruthy();
      expect(template.icon).toBeTruthy();
    });
  });

  it('defines valid road and junction lane sections', () => {
    [...catalog.roads, ...catalog.junctions.filter((template) => template.armSection).map((template) => template.armSection!)].forEach(
      (sectionLike) => {
        const section = 'left' in sectionLike ? sectionLike : sectionLike.armSection!;
        [...section.left, ...section.right].forEach((lane) => {
          expect(lane.laneType).toBeTruthy();
          expect(lane.width).toBeGreaterThan(0);
          if (lane.mark) {
            expect(lane.mark.type).toBeTruthy();
          }
        });
      },
    );
  });

  it('provides required fields for signal, marking, object and sign templates', () => {
    catalog.signals.forEach((template) => {
      expect(template.signalType).toBeTruthy();
    });

    catalog.markings.forEach((template) => {
      expect(template.mark.type).toBeTruthy();
    });

    catalog.objects.forEach((template) => {
      expect(template.objectType).toBeTruthy();
    });

    catalog.signs.forEach((template) => {
      expect(template.objectType).toBeTruthy();
    });
  });
});
