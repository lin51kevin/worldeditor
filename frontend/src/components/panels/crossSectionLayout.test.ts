import { describe, expect, it } from 'vitest';
import type { LaneSection, Road } from '../../services/platform';
import { computeCrossSection, evalLaneWidth } from './crossSectionLayout';

function section(s: number, leftWidths: number[], rightWidths: number[]): LaneSection {
  return {
    s,
    single_side: false,
    left: leftWidths.map((a, i) => ({
      id: i + 1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null },
      width: [{ s_offset: 0, a, b: 0, c: 0, d: 0 }], road_marks: [],
    })),
    center: [{ id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] }],
    right: rightWidths.map((a, i) => ({
      id: -(i + 1), lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null },
      width: [{ s_offset: 0, a, b: 0, c: 0, d: 0 }], road_marks: [],
    })),
  };
}

function road(sections: LaneSection[]): Road {
  return {
    id: 'r-1', name: 'r-1', length: 100, junction_id: null,
    link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [],
    lane_sections: sections,
  };
}

describe('evalLaneWidth', () => {
  it('evaluates the cubic at ds and clamps negatives to zero', () => {
    expect(evalLaneWidth([{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], 10)).toBeCloseTo(3.5);
    expect(evalLaneWidth([{ s_offset: 0, a: 2, b: 0.1, c: 0, d: 0 }], 10)).toBeCloseTo(3);
    expect(evalLaneWidth([{ s_offset: 0, a: -5, b: 0, c: 0, d: 0 }], 10)).toBe(0);
  });

  it('returns 0 for an empty widths array', () => {
    expect(evalLaneWidth([], 5)).toBe(0);
  });

  it('falls back to widths[0] when ds precedes the first s_offset', () => {
    // s_offset=10 > ds=0, so entry stays undefined → fallback to widths[0]
    const w = [{ s_offset: 10, a: 4.0, b: 0, c: 0, d: 0 }];
    expect(evalLaneWidth(w, 0)).toBeCloseTo(4.0);
  });

  it('selects the last record whose s_offset precedes ds', () => {
    const widths = [{ s_offset: 0, a: 3, b: 0, c: 0, d: 0 }, { s_offset: 5, a: 4, b: 0, c: 0, d: 0 }];
    expect(evalLaneWidth(widths, 2)).toBeCloseTo(3);
    expect(evalLaneWidth(widths, 8)).toBeCloseTo(4);
  });
});

describe('computeCrossSection', () => {
  it('stacks inner/outer edges per side and totals widths', () => {
    const cs = computeCrossSection(road([section(0, [3, 3.5], [3])]), 10);
    expect(cs.sectionIndex).toBe(0);
    expect(cs.totalLeft).toBeCloseTo(6.5);
    expect(cs.totalRight).toBeCloseTo(3);

    const l1 = cs.lanes.find((l) => l.side === 'left' && l.id === 1)!;
    const l2 = cs.lanes.find((l) => l.side === 'left' && l.id === 2)!;
    expect(l1.inner).toBeCloseTo(0);
    expect(l1.outer).toBeCloseTo(3);
    expect(l2.inner).toBeCloseTo(3);
    expect(l2.outer).toBeCloseTo(6.5);
  });

  it('resolves the active lane section for the given station', () => {
    const cs = computeCrossSection(road([section(0, [3], [3]), section(50, [4], [4])]), 60);
    expect(cs.sectionIndex).toBe(1);
    expect(cs.totalLeft).toBeCloseTo(4);
  });
});
