import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildGeoZProtoRoot, geoToProject, importGeoZ } from './parser';

async function createMinimalGeoZArchive(): Promise<ArrayBuffer> {
  const root = await buildGeoZProtoRoot();
  const topoMapType = root.lookupType('rt.hdmap.TopoMapFile');
  const tileRoadType = root.lookupType('rt.hdmap.TileRoadFile');
  const zip = new JSZip();

  const topoBuffer = topoMapType.encode({
    header: { name: 'Sample GeoZ' },
    roads: [
      {
        header: { id: 'road-1', length: 10, name: 'Road 1', junction_id: '' },
        road_sections: [
          {
            section_id: 'section-0',
            section_index: 0,
            s: 0,
            length: 10,
            section_direction_type: 'RIGHT_SECTION',
            lanes: [
              {
                header: { id: '-1', length: 10, lane_type: 1, name: 'lane-1' },
                predecessors: [],
                successors: [],
              },
            ],
          },
        ],
        road_predecessors: [],
        road_successors: [],
        road_signal: [],
        road_objects: [],
      },
    ],
    junctions: [],
  }).finish();

  const geoBuffer = tileRoadType.encode({
    road_geometry: {
      id: 'road-1',
      reference_line: {
        point: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
      lane_geometrys: [
        {
          id: '-1',
          left_boundary: {
            point: [
              { x: 0, y: -1.75, z: 0 },
              { x: 10, y: -1.75, z: 0 },
            ],
          },
          right_boundary: {
            point: [
              { x: 0, y: -5.25, z: 0 },
              { x: 10, y: -5.25, z: 0 },
            ],
          },
        },
      ],
    },
  }).finish();

  zip.file('road-1.topo', topoBuffer);
  zip.file('road-1.geo', geoBuffer);

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('geoz parser', () => {
  it('parses minimal valid GeoZ data', async () => {
    const content = await createMinimalGeoZArchive();

    const project = await importGeoZ(content, 'sample.geoz');

    expect(project.name).toBe('Sample GeoZ');
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0]).toMatchObject({
      id: 'road-1',
      name: 'Road 1',
      length: 10,
    });
    expect(project.roads[0]?.plan_view[0]).toMatchObject({
      x: 0,
      y: 0,
      length: 10,
      geo_type: 'Line',
    });
    expect(project.roads[0]?.lane_sections[0]?.right[0]).toMatchObject({
      id: -1,
      lane_type: 'Driving',
    });
  });

  it('handles empty input by returning an empty project', async () => {
    const content = await new JSZip().generateAsync({ type: 'arraybuffer' });

    await expect(importGeoZ(content, 'empty.geoz')).resolves.toMatchObject({
      name: 'empty',
      roads: [],
      junctions: [],
      signals: [],
      objects: [],
    });
  });

  it('converts decoded topo and geo data into the expected project structure', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'Road Network' },
          roads: [
            {
              header: { id: 'road-1', length: 0, name: 'Main Road', junction_id: 'junction-1' },
              road_predecessors: [
                { id: 'road-0', link_type: 'road', link_contact_point: 'start' },
              ],
              road_successors: [
                { id: 'junction-1', link_type: 'junction', link_contact_point: 'end' },
              ],
              road_sections: [
                {
                  section_id: 'section-0',
                  section_index: 0,
                  s: 0,
                  section_direction_type: 'LEFT_SECTION',
                  lanes: [
                    {
                      header: { id: '1', lane_type: 'driving' },
                      predecessors: [{ id: '1' }],
                      successors: [{ id: '1' }],
                    },
                  ],
                },
                {
                  section_id: 'section-0',
                  section_index: 0,
                  s: 0,
                  section_direction_type: 'RIGHT_SECTION',
                  lanes: [
                    {
                      header: { id: '-1', lane_type: 'driving' },
                      predecessors: [{ id: '-1' }],
                      successors: [{ id: '-1' }],
                    },
                  ],
                },
              ],
              road_signal: [{ id: 'signal-1', type: 'traffic_light' }],
              road_objects: [{ id: 'object-1', type: 'barrier', road_id: 'road-1' }],
            },
          ],
          junctions: [
            {
              header: { id: 'junction-1', name: 'Junction 1' },
              junction_links: [
                {
                  incoming_road: 'road-0',
                  connecting_road: 'road-1',
                  contact_point: 'END',
                  junction_lane_link: [{ from: '1', to: '-1' }],
                },
              ],
            },
          ],
        },
      ],
      [
        {
          stem: 'road-1',
          data: {
            road_geometry: {
              id: 'road-1',
              reference_line: {
                point: [
                  { x: 0, y: 0, z: 0 },
                  { x: 10, y: 0, z: 0 },
                ],
              },
              lane_geometrys: [
                {
                  id: '1',
                  left_boundary: {
                    point: [
                      { x: 0, y: 3.5, z: 0 },
                      { x: 10, y: 3.5, z: 0 },
                    ],
                  },
                  right_boundary: {
                    point: [
                      { x: 0, y: 0, z: 0 },
                      { x: 10, y: 0, z: 0 },
                    ],
                  },
                },
                {
                  id: '-1',
                  left_boundary: {
                    point: [
                      { x: 0, y: 0, z: 0 },
                      { x: 10, y: 0, z: 0 },
                    ],
                  },
                  right_boundary: {
                    point: [
                      { x: 0, y: -3.5, z: 0 },
                      { x: 10, y: -3.5, z: 0 },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
      'structure.geoz',
    );

    expect(project.name).toBe('Road Network');
    expect(project.header).toMatchObject({
      name: 'Road Network',
      west: 0,
      east: 10,
      south: 0,
      north: 0,
    });
    expect(project.roads[0]).toMatchObject({
      id: 'road-1',
      name: 'Main Road',
      length: 10,
      junction_id: 'junction-1',
      link: {
        predecessor: {
          element_id: 'road-0',
          element_type: 'Road',
          contact_point: 'Start',
        },
        successor: {
          element_id: 'junction-1',
          element_type: 'Junction',
          contact_point: 'End',
        },
      },
    });
    expect(project.roads[0]?.lane_sections[0]?.left[0]).toMatchObject({
      id: 1,
      lane_type: 'Driving',
    });
    expect(project.roads[0]?.lane_sections[0]?.right[0]).toMatchObject({
      id: -1,
      lane_type: 'Driving',
    });
    expect(project.junctions[0]).toMatchObject({
      id: 'junction-1',
      name: 'Junction 1',
    });
    expect(project.signals[0]).toMatchObject({
      id: 'signal-1',
      name: 'traffic_light',
    });
    // GeoZ proto objects lack geometry fields required by Rust RoadObject;
    // they are omitted to prevent WASM deserialization failures.
    expect(project.objects).toEqual([]);
  });

  it('parses road marks from lane geometry boundaries', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'Road Marks Test' },
          roads: [
            {
              header: { id: 'road-1', length: 10, name: 'Road 1', junction_id: '' },
              road_predecessors: [],
              road_successors: [],
              road_sections: [
                {
                  section_id: 's0', section_index: 0, s: 0,
                  section_direction_type: 'RIGHT_SECTION',
                  lanes: [
                    { header: { id: '-1', lane_type: 'driving' }, predecessors: [], successors: [] },
                  ],
                },
              ],
              road_signal: [],
              road_objects: [],
            },
          ],
          junctions: [],
        },
      ],
      [
        {
          stem: 'road-1',
          data: {
            road_geometry: {
              id: 'road-1',
              reference_line: { point: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
              lane_geometrys: [
                {
                  id: '-1',
                  left_boundary: {
                    point: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
                    road_mark: [
                      { offset: 0, length: 5, mark_type: 'type_solid', mark_color: 'color_white', mark_weight: 'weight_standard', width: 0.15 },
                      { offset: 5, length: 5, mark_type: 'type_broken', mark_color: 'color_yellow', mark_weight: 'weight_bold', width: 0.2 },
                    ],
                  },
                  right_boundary: {
                    point: [{ x: 0, y: -3.5, z: 0 }, { x: 10, y: -3.5, z: 0 }],
                  },
                },
              ],
            },
          },
        },
      ],
      'road-marks.geoz',
    );

    const lane = project.roads[0]?.lane_sections[0]?.right[0];
    expect(lane?.road_marks).toHaveLength(2);
    expect(lane?.road_marks[0]).toMatchObject({
      s_offset: 0,
      mark_type: 'solid',
      color: 'white',
      weight: 'standard',
      width: 0.15,
      material: '',
      lane_change: '',
    });
    expect(lane?.road_marks[1]).toMatchObject({
      s_offset: 5,
      mark_type: 'broken',
      color: 'yellow',
      weight: 'bold',
      width: 0.2,
      material: '',
      lane_change: '',
    });
  });

  it('returns empty road_marks when no geometry matches', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'No Match' },
          roads: [
            {
              header: { id: 'road-1', length: 10, name: 'R1', junction_id: '' },
              road_predecessors: [], road_successors: [],
              road_sections: [
                {
                  section_id: 's0', section_index: 0, s: 0,
                  section_direction_type: 'RIGHT_SECTION',
                  lanes: [
                    { header: { id: '-1', lane_type: 'driving' }, predecessors: [], successors: [] },
                  ],
                },
              ],
              road_signal: [], road_objects: [],
            },
          ],
          junctions: [],
        },
      ],
      [],
      'no-geo.geoz',
    );

    expect(project.roads[0]?.lane_sections[0]?.right[0]?.road_marks).toEqual([]);
  });

  it('throws when the input is not a valid GeoZ archive', async () => {
    const invalidContent = new TextEncoder().encode('not-a-zip').buffer;

    await expect(importGeoZ(invalidContent, 'broken.geoz')).rejects.toThrow(
      /Failed to read GeoZ archive/i,
    );
  });

  it('falls back to center_line when reference_line is missing', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'CenterLine Fallback' },
          roads: [
            {
              header: { id: 'road-1', length: 0, name: 'Road A', junction_id: '' },
              road_predecessors: [], road_successors: [],
              road_sections: [],
              road_signal: [], road_objects: [],
            },
          ],
          junctions: [],
        },
      ],
      [
        {
          stem: 'road-1',
          data: {
            road_geometry: {
              id: 'road-1',
              reference_line: { point: [] },
              center_line: {
                point: [
                  { x: 0, y: 0, z: 0 },
                  { x: 20, y: 5, z: 0 },
                  { x: 40, y: 0, z: 0 },
                ],
              },
              lane_geometrys: [],
            },
          },
        },
      ],
      'center-line.geoz',
    );

    expect(project.roads[0]?.plan_view.length).toBeGreaterThanOrEqual(2);
    expect(project.roads[0]?.plan_view[0]).toMatchObject({ x: 0, y: 0, geo_type: 'Line' });
  });

  it('synthesizes reference line from lane boundaries when reference_line and center_line are missing', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'Lane Boundary Fallback' },
          roads: [
            {
              header: { id: 'road-1', length: 0, name: 'Road B', junction_id: '' },
              road_predecessors: [], road_successors: [],
              road_sections: [
                {
                  section_id: 's0', section_index: 0, s: 0,
                  section_direction_type: 'RIGHT_SECTION',
                  lanes: [
                    { header: { id: '-1', lane_type: 'driving' }, predecessors: [], successors: [] },
                  ],
                },
              ],
              road_signal: [], road_objects: [],
            },
          ],
          junctions: [],
        },
      ],
      [
        {
          stem: 'road-1',
          data: {
            road_geometry: {
              id: 'road-1',
              // No reference_line, no center_line
              lane_geometrys: [
                {
                  id: '-1',
                  left_boundary: {
                    point: [
                      { x: 0, y: 2, z: 0 },
                      { x: 50, y: 2, z: 0 },
                    ],
                  },
                  right_boundary: {
                    point: [
                      { x: 0, y: -2, z: 0 },
                      { x: 50, y: -2, z: 0 },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
      'lane-fallback.geoz',
    );

    // Should have synthesized a center line at y=0 (avg of y=2 and y=-2)
    expect(project.roads[0]?.plan_view.length).toBeGreaterThanOrEqual(1);
    expect(project.roads[0]?.plan_view[0]).toMatchObject({ x: 0, y: 0, geo_type: 'Line' });
    expect(project.roads[0]?.plan_view[0]?.length).toBeCloseTo(50, 0);
  });

  it('produces empty plan_view when no geometry data is available', () => {
    const project = geoToProject(
      [
        {
          header: { name: 'No Geometry' },
          roads: [
            {
              header: { id: 'road-1', length: 30, name: 'Ghost Road', junction_id: '' },
              road_predecessors: [], road_successors: [],
              road_sections: [],
              road_signal: [], road_objects: [],
            },
          ],
          junctions: [],
        },
      ],
      [], // No geo files at all
      'no-geo.geoz',
    );

    expect(project.roads[0]?.plan_view).toEqual([]);
  });
});
