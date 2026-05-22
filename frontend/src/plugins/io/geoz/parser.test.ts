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
    expect(project.objects[0]).toMatchObject({
      id: 'object-1',
      roadId: 'road-1',
      type: 'barrier',
    });
  });

  it('throws when the input is not a valid GeoZ archive', async () => {
    const invalidContent = new TextEncoder().encode('not-a-zip').buffer;

    await expect(importGeoZ(invalidContent, 'broken.geoz')).rejects.toThrow(
      /Failed to read GeoZ archive/i,
    );
  });
});
