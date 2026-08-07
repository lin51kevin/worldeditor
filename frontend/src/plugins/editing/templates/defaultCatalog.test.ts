import { describe, expect, it } from 'vitest';
import catalog from './defaultCatalog';

describe('defaultCatalog', () => {
  it('exposes the expected catalog structure and section sizes', () => {
    expect(catalog.version).toBe('1.0.0');
    expect(catalog.roads).toHaveLength(7);
    expect(catalog.junctions).toHaveLength(8);
    expect(catalog.signals).toHaveLength(7);
    expect(catalog.markings).toHaveLength(0);
    expect(catalog.paints).toHaveLength(15);
    expect(catalog.objects).toHaveLength(20);
    expect(catalog.signs).toHaveLength(7);
  });

  it('gives every template a unique id and required common fields', () => {
    const allTemplates = [
      ...catalog.roads,
      ...catalog.junctions,
      ...catalog.signals,
      ...catalog.markings,
      ...catalog.paints,
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

  /// Every object type the Rust renderer knows must be placeable, otherwise the
  /// backend can draw shapes the editor has no way to create.
  it('covers every renderable road-object type', () => {
    const placeable = new Set<string>([
      ...catalog.objects.map((template) => template.objectType),
      ...catalog.signs.map((template) => template.objectType),
    ]);

    // Mirrors the Rust `ObjectType` enum minus `Custom` and the deprecated
    // `Pillar` alias (imports still parse it; templates use `Pole`).
    const renderable = [
      'Crosswalk', 'StopLine', 'SlowDownToYieldLine', 'StopToYieldLine',
      'CrossHatchArea', 'SimpleCrossHatch', 'WovenArea', 'ForwardWaitingArea',
      'TurnLeftWaitingArea', 'ParkingSpace', 'Guardrail', 'Barrier', 'Curb',
      'SidewalkRail', 'FlowerBed', 'TrashBin', 'Bridge', 'Tunnel', 'TrafficCone',
      'StreetLightPole', 'Sign', 'SignGantry', 'SimpleSignalPole',
      'TrafficLightPole', 'LTypeSignalPole', 'TTypeSignalPole', 'Pole',
    ];

    renderable.forEach((objectType) => {
      expect(placeable.has(objectType), `missing template for ${objectType}`).toBe(true);
    });
  });

  it('points every thumbnail at the shared texture folder', () => {
    [...catalog.objects, ...catalog.signs].forEach((template) => {
      if (template.thumbnailUrl) {
        expect(template.thumbnailUrl).toMatch(/^\/assets\/textures\/Objects\/[\w-]+\.png$/);
      }
    });
  });
});
