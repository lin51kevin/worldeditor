import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, saveExport, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  saveExport: vi.fn(),
  wasm: {
    import_from_nio: vi.fn(),
    export_to_nio: vi.fn(),
  },
}));

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: () => ({ registerImporter, registerExporter, unregisterPlugin }),
  },
}));

vi.mock('../../../utils/download', () => ({
  saveExport,
}));

vi.mock('../../../../wasm/pkg/we_wasm', () => wasm);

import { mountIoNioPlugin } from './io-nio.plugin';

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

describe('io-nio.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoNioPlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-nio');
  });

  it('imports NIO bytes through wasm', async () => {
    const imported = makeProject('imported');
    wasm.import_from_nio.mockReturnValueOnce(imported);
    mountIoNioPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const input = new Uint8Array([3, 2, 1]);
    const result = await importer.onImport(input.buffer, 'demo.bin');
    const wasmArg = wasm.import_from_nio.mock.calls[0]?.[0] as Uint8Array;
    expect(Array.from(wasmArg)).toEqual([3, 2, 1]);
    expect(result).toEqual(imported);
  });

  it('imports string input by encoding to bytes', async () => {
    wasm.import_from_nio.mockReturnValueOnce(makeProject('string-input'));
    mountIoNioPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    await importer.onImport('abc', 'demo.bin');
    const wasmArg = wasm.import_from_nio.mock.calls[0]?.[0] as Uint8Array;
    expect(Array.from(wasmArg)).toEqual(Array.from(new TextEncoder().encode('abc')));
  });

  it('exports NIO through wasm and downloads .bin file', async () => {
    wasm.export_to_nio.mockReturnValueOnce(new Uint8Array([7, 8, 9]));
    const project = makeProject('binary-map');
    mountIoNioPlugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.export_to_nio).toHaveBeenCalledWith(JSON.stringify(project));
    expect(saveExport).toHaveBeenCalledWith(expect.any(Blob), 'binary-map.bin', expect.anything());
    const blob = saveExport.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
  });
});
