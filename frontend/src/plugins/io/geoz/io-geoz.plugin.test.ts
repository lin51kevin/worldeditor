import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const mockRegisterImporter = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerImporter: mockRegisterImporter,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

import { buildGeoZProtoRoot, mountIoGeoZPlugin } from './io-geoz.plugin';

describe('io-geoz.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers importer with correct format name', () => {
    const cleanup = mountIoGeoZPlugin();
    const importer = mockRegisterImporter.mock.calls[0]?.[0];

    expect(importer).toMatchObject({
      id: 'io-geoz-import:importer',
      pluginId: 'io-geoz-import',
      formatName: 'GeoZ Map',
      extensions: ['.geoz', '.zip'],
      disabled: false,
    });

    cleanup();
  });

  it('throws on non-ZIP input', async () => {
    const cleanup = mountIoGeoZPlugin();
    const importer = mockRegisterImporter.mock.calls[0]?.[0];

    await expect(
      importer.onImport(new TextEncoder().encode('not-a-zip').buffer, 'broken.geoz'),
    ).rejects.toThrow(/GeoZ archive|zip/i);

    cleanup();
  });

  it('handles empty ZIP gracefully', async () => {
    const cleanup = mountIoGeoZPlugin();
    const importer = mockRegisterImporter.mock.calls[0]?.[0];
    const content = await new JSZip().generateAsync({ type: 'arraybuffer' });

    await expect(importer.onImport(content, 'empty.geoz')).resolves.toMatchObject({
      name: 'empty',
      roads: [],
      junctions: [],
      signals: [],
      objects: [],
    });

    cleanup();
  });

  it('imports a simple GeoZ archive', async () => {
    const cleanup = mountIoGeoZPlugin();
    const importer = mockRegisterImporter.mock.calls[0]?.[0];
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
            center_boundary: {
              point: [
                { x: 0, y: -3.5, z: 0 },
                { x: 10, y: -3.5, z: 0 },
              ],
            },
          },
        ],
      },
    }).finish();

    zip.file('road-1.topo', topoBuffer);
    zip.file('road-1.geo', geoBuffer);

    const content = await zip.generateAsync({ type: 'arraybuffer' });
    const project = await importer.onImport(content, 'sample.geoz');

    expect(project.name).toBe('Sample GeoZ');
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0]).toMatchObject({
      id: 'road-1',
      name: 'Road 1',
      length: 10,
    });
    expect(project.roads[0]?.plan_view).toHaveLength(1);
    expect(project.roads[0]?.lane_sections[0]?.right[0]).toMatchObject({
      id: -1,
      lane_type: 'Driving',
    });

    cleanup();
  });

  it('uses a worker for large GeoZ archives and terminates it after parsing', async () => {
    const cleanup = mountIoGeoZPlugin();
    const importer = mockRegisterImporter.mock.calls[0]?.[0];
    const terminate = vi.fn();
    const worker = {
      onmessage: null as ((event: MessageEvent<{ type: string; data?: unknown; message?: string }>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage: vi.fn((message: unknown, transfer?: Transferable[]) => {
        expect(message).toEqual({
          type: 'parse-geoz',
          buffer: largeBuffer,
          fileName: 'worker.geoz',
        });
        expect(transfer).toEqual([largeBuffer]);

        queueMicrotask(() => {
          worker.onmessage?.({
            data: {
              type: 'result',
              data: {
                protoTopoFiles: [
                  {
                    header: { name: 'Worker GeoZ' },
                    roads: [
                      {
                        header: { id: 'road-1', length: 10, name: 'Road 1', junction_id: '' },
                        road_sections: [],
                        road_predecessors: [],
                        road_successors: [],
                        road_signal: [],
                        road_objects: [],
                      },
                    ],
                    junctions: [],
                  },
                ],
                protoGeoFiles: [
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
                        lane_geometrys: [],
                      },
                    },
                  },
                ],
                fileName: 'worker.geoz',
              },
            },
          } as MessageEvent<{ type: string; data?: unknown; message?: string }>);
        });
      }),
      terminate,
    };
    const largeBuffer = new ArrayBuffer(5 * 1024 * 1024 + 1);
    const WorkerMock = vi.fn(() => worker);
    vi.stubGlobal('Worker', WorkerMock);

    const project = await importer.onImport(largeBuffer, 'worker.geoz');

    expect(WorkerMock).toHaveBeenCalledOnce();
    expect(project.name).toBe('Worker GeoZ');
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0]?.plan_view).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();

    cleanup();
  });
});
