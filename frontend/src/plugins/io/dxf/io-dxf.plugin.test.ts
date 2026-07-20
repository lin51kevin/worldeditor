import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, saveExport, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  saveExport: vi.fn(),
  wasm: {
    import_from_dxf: vi.fn(),
    export_to_dxf: vi.fn(),
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

import { mountIoDxfPlugin } from './io-dxf.plugin';

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

describe('io-dxf.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoDxfPlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-dxf');
  });

  it('imports DXF text through wasm', async () => {
    const imported = makeProject('imported');
    wasm.import_from_dxf.mockReturnValueOnce(imported);
    mountIoDxfPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const result = await importer.onImport('SECTION', 'map.dxf');
    expect(wasm.import_from_dxf).toHaveBeenCalledWith('SECTION');
    expect(result).toEqual(imported);
  });

  it('imports DXF ArrayBuffer through wasm', async () => {
    const imported = makeProject('buffer');
    wasm.import_from_dxf.mockReturnValueOnce(imported);
    mountIoDxfPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const buffer = new TextEncoder().encode('HEADER').buffer;
    await importer.onImport(buffer, 'map.dxf');
    expect(wasm.import_from_dxf).toHaveBeenCalledWith('HEADER');
  });

  it('exports DXF via wasm and downloads .dxf file', async () => {
    wasm.export_to_dxf.mockReturnValueOnce('DXF_CONTENT');
    const project = makeProject('roadnet');
    mountIoDxfPlugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.export_to_dxf).toHaveBeenCalledWith(JSON.stringify(project));
    expect(saveExport).toHaveBeenCalledWith(expect.any(Blob), 'roadnet.dxf', expect.anything());
    const blob = saveExport.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/dxf');
  });
});