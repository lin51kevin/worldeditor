import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, downloadBlob, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  downloadBlob: vi.fn(),
  wasm: {
    import_from_shapefile: vi.fn(),
    export_to_shapefile: vi.fn(),
  },
}));

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: () => ({ registerImporter, registerExporter, unregisterPlugin }),
  },
}));

vi.mock('../../../utils/download', () => ({
  downloadBlob,
}));

vi.mock('../../../../wasm/pkg/we_wasm', () => wasm);

import { mountIoShapefilePlugin } from './io-shapefile.plugin';

function makeProject(name = 'demo'): Project {
  return {
    name,
    roads: [],
    signals: [],
    objects: [],
    junctions: [],
    header: {
      rev_major: 1,
      rev_minor: 6,
      name,
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
  } as Project;
}

describe('io-shapefile.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoShapefilePlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-shapefile');
  });

  it('imports shapefile bytes through wasm', async () => {
    const imported = makeProject('imported');
    wasm.import_from_shapefile.mockReturnValueOnce(imported);
    mountIoShapefilePlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const inputBytes = new Uint8Array([1, 2, 3]);
    await importer.onImport(inputBytes.buffer, 'demo.shp');
    const wasmArg = wasm.import_from_shapefile.mock.calls[0]?.[0] as Uint8Array;
    expect(wasmArg).toBeInstanceOf(Uint8Array);
    expect(Array.from(wasmArg)).toEqual([1, 2, 3]);
  });

  it('imports string input by encoding to bytes', async () => {
    wasm.import_from_shapefile.mockReturnValueOnce(makeProject('string-input'));
    mountIoShapefilePlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    await importer.onImport('abc', 'demo.shp');
    const wasmArg = wasm.import_from_shapefile.mock.calls[0]?.[0] as Uint8Array;
    expect(Array.from(wasmArg)).toEqual(Array.from(new TextEncoder().encode('abc')));
  });

  it('exports shapefile via wasm and downloads .shp file', async () => {
    wasm.export_to_shapefile.mockReturnValueOnce(new Uint8Array([9, 8, 7]));
    const project = makeProject('city');
    mountIoShapefilePlugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.export_to_shapefile).toHaveBeenCalledWith(JSON.stringify(project));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'city.shp');
    const blob = downloadBlob.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
  });
});