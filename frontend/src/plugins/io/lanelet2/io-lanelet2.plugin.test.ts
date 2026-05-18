import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, downloadBlob, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  downloadBlob: vi.fn(),
  wasm: {
    import_from_lanelet2: vi.fn(),
    export_to_lanelet2: vi.fn(),
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

import { mountIoLanelet2Plugin } from './io-lanelet2.plugin';

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

describe('io-lanelet2.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoLanelet2Plugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-lanelet2');
  });

  it('imports OSM XML text through wasm', async () => {
    const imported = makeProject('lanelet2');
    wasm.import_from_lanelet2.mockReturnValueOnce(imported);
    mountIoLanelet2Plugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const result = await importer.onImport('<osm></osm>', 'demo.osm');
    expect(wasm.import_from_lanelet2).toHaveBeenCalledWith('<osm></osm>');
    expect(result).toEqual(imported);
  });

  it('imports ArrayBuffer by decoding to XML text', async () => {
    wasm.import_from_lanelet2.mockReturnValueOnce(makeProject('buffer'));
    mountIoLanelet2Plugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const buffer = new TextEncoder().encode('<osm version="0.6" />').buffer;
    await importer.onImport(buffer, 'demo.osm');
    expect(wasm.import_from_lanelet2).toHaveBeenCalledWith('<osm version="0.6" />');
  });

  it('exports Lanelet2 through wasm and downloads .osm file', async () => {
    wasm.export_to_lanelet2.mockReturnValueOnce('<osm id="1" />');
    const project = makeProject('network');
    mountIoLanelet2Plugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.export_to_lanelet2).toHaveBeenCalledWith(JSON.stringify(project));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'network_lanelet2.osm');
    const blob = downloadBlob.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/xml');
  });
});
