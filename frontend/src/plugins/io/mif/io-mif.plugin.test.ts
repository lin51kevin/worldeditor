import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, downloadBlob, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  downloadBlob: vi.fn(),
  wasm: {
    import_from_mif: vi.fn(),
    export_to_mif: vi.fn(),
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

import { mountIoMifPlugin } from './io-mif.plugin';

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

describe('io-mif.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoMifPlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-mif');
  });

  it('imports MIF text through wasm', async () => {
    const imported = makeProject('imported');
    wasm.import_from_mif.mockReturnValueOnce(imported);
    mountIoMifPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const result = await importer.onImport('Version 300', 'demo.mif');
    expect(wasm.import_from_mif).toHaveBeenCalledWith('Version 300');
    expect(result).toEqual(imported);
  });

  it('imports MIF ArrayBuffer by decoding to text', async () => {
    wasm.import_from_mif.mockReturnValueOnce(makeProject('from-buffer'));
    mountIoMifPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const buffer = new TextEncoder().encode('Columns 1').buffer;
    await importer.onImport(buffer, 'demo.mif');
    expect(wasm.import_from_mif).toHaveBeenCalledWith('Columns 1');
  });

  it('exports MIF through wasm and downloads .mif file', async () => {
    wasm.export_to_mif.mockReturnValueOnce('MIF_CONTENT');
    const project = makeProject('parcel');
    mountIoMifPlugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.export_to_mif).toHaveBeenCalledWith(JSON.stringify(project));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'parcel.mif');
    const blob = downloadBlob.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
  });
});
