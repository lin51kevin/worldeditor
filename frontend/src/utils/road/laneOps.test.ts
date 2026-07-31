import { describe, expect, it } from 'vitest';
import type { LaneSection } from '../../services/platform';
import {
  cloneLaneWithMirroredId,
  evalLaneSectionAtOffset,
  getLaneSignature,
  makeMark,
  makeSidewalkLane,
  reverseLaneSection,
} from './laneOps';

function emptySection(overrides: Partial<LaneSection> = {}): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [],
    center: [{ id: 0, lane_type: 'None', level: 0, link: null, width: [], road_marks: [] }],
    right: [],
    ...overrides,
  };
}

describe('makeMark', () => {
  it('sets lane_change to "both" for Broken marks', () => {
    expect(makeMark('Broken').lane_change).toBe('both');
  });

  it('sets lane_change to "none" for Solid marks', () => {
    expect(makeMark('Solid').lane_change).toBe('none');
  });

  it('accepts a custom color', () => {
    expect(makeMark('None', 'Yellow').color).toBe('Yellow');
  });
});

describe('makeSidewalkLane', () => {
  it('uses default width 2.0 when not specified', () => {
    const lane = makeSidewalkLane(3);
    expect(lane.width[0]!.a).toBe(2.0);
    expect(lane.id).toBe(3);
  });

  it('uses the provided width', () => {
    const lane = makeSidewalkLane(-2, 1.5);
    expect(lane.width[0]!.a).toBe(1.5);
  });
});

describe('cloneLaneWithMirroredId', () => {
  it('mirrors positive id to negative', () => {
    const lane = cloneLaneWithMirroredId({ id: 2, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] });
    expect(lane.id).toBe(-2);
  });

  it('keeps id 0 unchanged', () => {
    const lane = cloneLaneWithMirroredId({ id: 0, lane_type: 'None', level: 0, link: null, width: [], road_marks: [] });
    expect(lane.id).toBe(0);
  });

  it('handles null link without throwing', () => {
    const lane = cloneLaneWithMirroredId({ id: 1, lane_type: 'Driving', level: 0, link: null, width: [], road_marks: [] });
    expect(lane.id).toBe(-1);
    expect(lane.link).toBeNull();
  });

  it('negates predecessor/successor when link has non-null values', () => {
    const lane = cloneLaneWithMirroredId({
      id: 1, lane_type: 'Driving', level: 0,
      link: { predecessor: 2, successor: null },
      width: [], road_marks: [],
    });
    expect(lane.link?.predecessor).toBeNull();
    expect(lane.link?.successor).toBe(-2);
  });
});

describe('getLaneSignature', () => {
  it('returns "none" for undefined section', () => {
    expect(getLaneSignature(undefined)).toBe('none');
  });

  it('encodes lanes sorted by abs id and type', () => {
    const sec = emptySection({
      left: [{ id: 1, lane_type: 'Driving', level: 0, link: null, width: [], road_marks: [] }],
      right: [{ id: -1, lane_type: 'Shoulder', level: 0, link: null, width: [], road_marks: [] }],
    });
    const sig = getLaneSignature(sec);
    expect(sig).toContain('1:Driving');
    expect(sig).toContain('1:Shoulder');
  });
});

describe('evalLaneSectionAtOffset', () => {
  it('preserves empty width arrays without modification', () => {
    const sec = emptySection({
      left: [{ id: 1, lane_type: 'Driving', level: 0, link: null, width: [], road_marks: [] }],
    });
    const result = evalLaneSectionAtOffset(sec, 5);
    expect(result.left[0]!.width).toHaveLength(0);
  });

  it('bakes the evaluated width at the given offset', () => {
    const sec = emptySection({
      right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 4, b: 0, c: 0, d: 0 }], road_marks: [] }],
    });
    const result = evalLaneSectionAtOffset(sec, 0);
    expect(result.right[0]!.width[0]!.a).toBeCloseTo(4);
    expect(result.right[0]!.width[0]!.s_offset).toBe(0);
  });
});

describe('reverseLaneSection', () => {
  it('swaps left and right lanes with mirrored IDs', () => {
    const sec = emptySection({
      left: [{ id: 1, lane_type: 'Driving', level: 0, link: null, width: [], road_marks: [] }],
      right: [{ id: -1, lane_type: 'Shoulder', level: 0, link: null, width: [], road_marks: [] }],
    });
    const rev = reverseLaneSection(sec);
    expect(rev.left[0]!.id).toBe(1);  // mirrored from right's -1
    expect(rev.right[0]!.id).toBe(-1); // mirrored from left's 1
    expect(rev.left[0]!.lane_type).toBe('Shoulder');
    expect(rev.right[0]!.lane_type).toBe('Driving');
  });
});
