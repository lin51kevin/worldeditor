import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../services/platform';

const { registerImporter, registerExporter, unregisterPlugin, downloadBlob, wasm } = vi.hoisted(() => ({
  registerImporter: vi.fn(),
  registerExporter: vi.fn(),
  unregisterPlugin: vi.fn(),
  downloadBlob: vi.fn(),
  wasm: {
    parse_opendrive: vi.fn(),
    write_opendrive: vi.fn(),
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

import { mountIoXodrExtPlugin } from './io-xodr-ext.plugin';

function makeProject(name = 'demo', revMinor = 4): Project {
  return {
    name,
    roads: [],
    signals: [],
    objects: [],
    junctions: [],
    header: {
      rev_major: 1,
      rev_minor: revMinor,
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

describe('io-xodr-ext.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers importer/exporter and cleans up', () => {
    const dispose = mountIoXodrExtPlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-xodr-ext');
  });

  it('imports OpenDRIVE and migrates header version to 1.6', async () => {
    const imported = makeProject('legacy', 4);
    wasm.parse_opendrive.mockReturnValueOnce(imported);
    mountIoXodrExtPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const result = await importer.onImport('<OpenDRIVE />', 'legacy.xodr');
    expect(wasm.parse_opendrive).toHaveBeenCalledWith('<OpenDRIVE />');
    expect(result.header?.rev_major).toBe(1);
    expect(result.header?.rev_minor).toBe(6);
  });

  it('imports ArrayBuffer by decoding to XML text', async () => {
    wasm.parse_opendrive.mockReturnValueOnce(makeProject('buffer-input', 5));
    mountIoXodrExtPlugin();
    const importer = registerImporter.mock.calls[0]?.[0];
    const buffer = new TextEncoder().encode('<OpenDRIVE version="1.6" />').buffer;
    await importer.onImport(buffer, 'demo.xodr');
    expect(wasm.parse_opendrive).toHaveBeenCalledWith('<OpenDRIVE version="1.6" />');
  });

  it('exports OpenDRIVE via wasm and downloads .xodr file', async () => {
    wasm.write_opendrive.mockReturnValueOnce('<OpenDRIVE version="1.6" />');
    const project = makeProject('city', 6);
    mountIoXodrExtPlugin();
    const exporter = registerExporter.mock.calls[0]?.[0];
    await exporter.onExport(project);
    expect(wasm.write_opendrive).toHaveBeenCalledWith(JSON.stringify(project));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'city_v1.6.xodr');
    const blob = downloadBlob.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/xml');
  });
});
