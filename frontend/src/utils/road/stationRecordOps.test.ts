import { describe, it, expect } from 'vitest';
import {
  clampStation,
  dedupeStationRecords,
  capStationRecords,
  capStationRangeRecords,
  buildSampleStations,
  offsetStationRecords,
  offsetStationRangeRecords,
  reverseStationRecords,
  reverseStationRangeRecords,
  reverseLaneSections,
  capLateralProfile,
  capRoadObjects,
  offsetRoadObjects,
  reverseRoadObjects,
  combineLateralProfile,
} from './stationRecordOps';

describe('clampStation', () => {
  it('clamps within [0, maxLength]', () => {
    expect(clampStation(-1, 100)).toBe(0);
    expect(clampStation(50, 100)).toBe(50);
    expect(clampStation(200, 100)).toBe(100);
  });
});

describe('dedupeStationRecords', () => {
  it('removes duplicates at same station', () => {
    const records = [{ s: 0, v: 'a' }, { s: 0, v: 'b' }, { s: 1, v: 'c' }];
    const result = dedupeStationRecords(records);
    expect(result).toHaveLength(2);
    expect(result[0].v).toBe('b'); // later record wins
    expect(result[1].v).toBe('c');
  });

  it('keeps distinct stations', () => {
    const records = [{ s: 0 }, { s: 1 }, { s: 2 }];
    expect(dedupeStationRecords(records)).toHaveLength(3);
  });
});

describe('capStationRecords', () => {
  it('clamps records to max length and dedupes', () => {
    const records = [{ s: 0 }, { s: 50 }, { s: 150 }];
    const result = capStationRecords(records, 100);
    expect(result!.every((r) => r.s <= 100)).toBe(true);
  });

  it('returns undefined for undefined input', () => {
    expect(capStationRecords(undefined, 100)).toBeUndefined();
  });
});

describe('capStationRangeRecords', () => {
  it('clamps s and adjusts length', () => {
    const records = [{ s: 90, length: 20 }];
    const result = capStationRangeRecords(records, 100);
    expect(result![0].s).toBe(90);
    expect(result![0].length).toBe(10);
  });

  it('returns undefined for undefined input', () => {
    expect(capStationRangeRecords(undefined, 100)).toBeUndefined();
  });
});

describe('buildSampleStations', () => {
  it('builds stations at regular intervals ending at roadLength', () => {
    const stations = buildSampleStations(10, 3);
    expect(stations[0]).toBe(0);
    expect(stations[stations.length - 1]).toBe(10);
    expect(stations.length).toBe(5); // 0, 3, 6, 9, 10
  });

  it('returns [0] for zero length', () => {
    expect(buildSampleStations(0, 5)).toEqual([0]);
  });

  it('returns [0] for negative length', () => {
    expect(buildSampleStations(-1, 5)).toEqual([0]);
  });
});

describe('offsetStationRecords', () => {
  it('adds offset to each record s value', () => {
    const records = [{ s: 0 }, { s: 5 }];
    const result = offsetStationRecords(records, 10);
    expect(result![0].s).toBe(10);
    expect(result![1].s).toBe(15);
  });

  it('returns undefined for undefined input', () => {
    expect(offsetStationRecords(undefined, 10)).toBeUndefined();
  });
});

describe('offsetStationRangeRecords', () => {
  it('adds offset to range records', () => {
    const records = [{ s: 5, length: 10 }];
    const result = offsetStationRangeRecords(records, 3);
    expect(result![0].s).toBe(8);
  });
});

describe('reverseStationRecords', () => {
  it('reverses station positions and sorts', () => {
    const records = [{ s: 10 }, { s: 30 }, { s: 80 }];
    const result = reverseStationRecords(records, 100);
    expect(result![0].s).toBe(20);
    expect(result![1].s).toBe(70);
    expect(result![2].s).toBe(90);
  });

  it('returns undefined for undefined input', () => {
    expect(reverseStationRecords(undefined, 100)).toBeUndefined();
  });
});

describe('reverseStationRangeRecords', () => {
  it('reverses range positions', () => {
    const records = [{ s: 10, length: 20 }];
    const result = reverseStationRangeRecords(records, 100);
    // reversed s = 100 - (10 + 20) = 70
    expect(result![0].s).toBe(70);
  });

  it('returns undefined for undefined input', () => {
    expect(reverseStationRangeRecords(undefined, 100)).toBeUndefined();
  });
});

describe('capLateralProfile', () => {
  it('caps all sub-record arrays', () => {
    const profile = {
      superelevation: [{ s: 150 }],
      crossfall: [{ s: 50 }],
      superelevations: [{ s: 200 }],
      crossfalls: [{ s: 30 }],
    };
    const result = capLateralProfile(profile as any, 100);
    expect(result!.superelevation![0].s).toBe(100);
    expect(result!.crossfall![0].s).toBe(50);
  });

  it('returns undefined for undefined input', () => {
    expect(capLateralProfile(undefined, 100)).toBeUndefined();
  });
});

describe('capRoadObjects', () => {
  it('clamps object position.x', () => {
    const objects = [{ id: '1', position: { x: 150, y: 0, z: 0 } }];
    const result = capRoadObjects(objects as any, 100);
    expect(result![0].position.x).toBe(100);
  });
});

describe('offsetRoadObjects', () => {
  it('offsets object position.x and corner x', () => {
    const objects = [{ id: '1', position: { x: 10, y: 0, z: 0 }, corners: [{ x: 10 }] }];
    const result = offsetRoadObjects(objects as any, 5);
    expect(result![0].position.x).toBe(15);
    expect(result![0].corners[0].x).toBe(15);
  });
});

describe('combineLateralProfile', () => {
  it('combines two profiles with offset', () => {
    const p1 = { superelevation: [{ s: 0 }], crossfall: [], superelevations: [], crossfalls: [] };
    const p2 = { superelevation: [{ s: 5 }], crossfall: [], superelevations: [], crossfalls: [] };
    const result = combineLateralProfile(p1 as any, p2 as any, 100);
    expect(result!.superelevation).toHaveLength(2);
    expect(result!.superelevation![1].s).toBe(105);
  });

  it('returns undefined when both are undefined', () => {
    expect(combineLateralProfile(undefined, undefined, 0)).toBeUndefined();
  });
});

describe('reverseLaneSections', () => {
  it('returns empty array for empty input', () => {
    expect(reverseLaneSections([], 100)).toEqual([]);
  });

  it('reverses section start positions', () => {
    const sections = [
      { s: 0, left: [], right: [], center: [] },
      { s: 50, left: [], right: [], center: [] },
    ];
    const result = reverseLaneSections(sections as any, 100);
    expect(result[0].s).toBe(0);
    expect(result[1].s).toBe(50);
  });
});

describe('reverseRoadObjects', () => {
  it('reverses object positions and adjusts heading', () => {
    const objects = [
      { id: '1', position: { x: 20, y: 0, z: 0 }, hdg: 0, orientation: 0, corners: [{ x: 20 }], validity: null },
    ];
    const result = reverseRoadObjects(objects as any, 100);
    expect(result![0].position.x).toBe(80);
  });

  it('flips lane validity', () => {
    const objects = [
      { id: '1', position: { x: 50, y: 0, z: 0 }, hdg: 0, orientation: 0, corners: [], validity: { from_lane: 1, to_lane: 3 } },
    ];
    const result = reverseRoadObjects(objects as any, 100);
    expect(result![0].validity).toEqual({ from_lane: -3, to_lane: -1 });
  });
});
