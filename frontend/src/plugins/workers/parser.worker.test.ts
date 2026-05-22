import { afterEach, describe, expect, it, vi } from 'vitest';

type ParseGeoZMessage = {
  type: 'parse-geoz';
  buffer: ArrayBuffer;
  fileName: string;
};

type WorkerReply = {
  type: string;
  data?: unknown;
  message?: string;
};

type MockWorkerGlobal = {
  onmessage: ((event: MessageEvent<ParseGeoZMessage | { type: string }>) => void | Promise<void>) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

async function loadWorkerModule(options?: {
  zipFiles?: Record<string, { dir: boolean; name: string; async: ReturnType<typeof vi.fn> }>;
  loadError?: Error;
}) {
  vi.resetModules();

  const selfMock: MockWorkerGlobal = {
    onmessage: null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', selfMock);

  const loadAsync = vi.fn();
  if (options?.loadError) {
    loadAsync.mockRejectedValue(options.loadError);
  } else {
    loadAsync.mockResolvedValue({ files: options?.zipFiles ?? {} });
  }

  vi.doMock('jszip', () => ({
    default: {
      loadAsync,
    },
  }));

  const topoMapType = {
    decode: vi.fn(() => ({ kind: 'topo' })),
    toObject: vi.fn(() => ({ header: { name: 'Worker Map' }, roads: [], junctions: [] })),
  };
  const tileRoadType = {
    decode: vi.fn(() => ({ kind: 'geo' })),
    toObject: vi.fn(() => ({ road_geometry: { id: 'road-1' } })),
  };

  class MockRoot {
    lookupType(name: string) {
      return name === 'rt.hdmap.TopoMapFile' ? topoMapType : tileRoadType;
    }
  }

  const pb = {
    Root: MockRoot,
    parse: vi.fn(),
  };

  vi.doMock('protobufjs', () => ({
    ...pb,
    default: pb,
  }));

  await import('./parser.worker');

  return { selfMock, loadAsync };
}

describe('parser.worker', () => {
  afterEach(() => {
    vi.doUnmock('jszip');
    vi.doUnmock('protobufjs');
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('ignores unrelated messages', async () => {
    const { selfMock } = await loadWorkerModule();

    await selfMock.onmessage?.({ data: { type: 'noop' } } as MessageEvent<{ type: string }>);

    expect(selfMock.postMessage).not.toHaveBeenCalled();
  });

  it('handles parse-geoz messages and posts decoded results', async () => {
    const topoEntry = {
      dir: false,
      name: 'nested/road-1.topo',
      async: vi.fn().mockResolvedValue(new Uint8Array([1])),
    };
    const geoEntry = {
      dir: false,
      name: 'nested/road-1.geo',
      async: vi.fn().mockResolvedValue(new Uint8Array([2])),
    };

    const { selfMock, loadAsync } = await loadWorkerModule({
      zipFiles: {
        'nested/road-1.topo': topoEntry,
        'nested/road-1.geo': geoEntry,
      },
    });

    await selfMock.onmessage?.({
      data: {
        type: 'parse-geoz',
        buffer: new ArrayBuffer(8),
        fileName: 'worker.geoz',
      },
    } as MessageEvent<ParseGeoZMessage>);

    expect(loadAsync).toHaveBeenCalledOnce();
    expect(selfMock.postMessage).toHaveBeenCalledWith({
      type: 'ok',
      data: {
        protoTopoFiles: [{ header: { name: 'Worker Map' }, roads: [], junctions: [] }],
        protoGeoFiles: [{ stem: 'road-1', data: { road_geometry: { id: 'road-1' } } }],
        fileName: 'worker.geoz',
      },
    });
  });

  it('posts an error message when parsing fails', async () => {
    const { selfMock } = await loadWorkerModule({
      loadError: new Error('zip failed'),
    });

    await selfMock.onmessage?.({
      data: {
        type: 'parse-geoz',
        buffer: new ArrayBuffer(4),
        fileName: 'broken.geoz',
      },
    } as MessageEvent<ParseGeoZMessage>);

    expect(selfMock.postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: 'zip failed',
    });
  });
});
