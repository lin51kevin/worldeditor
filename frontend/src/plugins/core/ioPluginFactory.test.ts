import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from './emptyProject';

const registerImporter = vi.fn();
const registerExporter = vi.fn();
const unregisterPlugin = vi.fn();

vi.mock('../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerImporter,
      registerExporter,
      unregisterPlugin,
    })),
  },
}));

import { createIOPlugin, createIOPluginStub } from './ioPluginFactory';

describe('createIOPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers configured importer/exporter with derived ids and default flags', () => {
    const onImport = vi.fn();
    const onExport = vi.fn();

    const cleanup = createIOPlugin({
      pluginId: 'io-demo',
      importer: {
        formatName: 'Demo Import',
        extensions: ['.demo'],
        onImport,
      },
      exporter: {
        formatName: 'Demo Export',
        onExport,
      },
    })();

    expect(registerImporter).toHaveBeenCalledWith({
      id: 'io-demo:importer',
      pluginId: 'io-demo',
      formatName: 'Demo Import',
      extensions: ['.demo'],
      disabled: false,
      onImport,
    });
    expect(registerExporter).toHaveBeenCalledWith({
      id: 'io-demo:exporter',
      pluginId: 'io-demo',
      formatName: 'Demo Export',
      disabled: false,
      onExport,
    });

    cleanup();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-demo');
  });

  it('only registers the capabilities present in the config', () => {
    const cleanup = createIOPlugin({
      pluginId: 'io-import-only',
      importer: {
        formatName: 'Import Only',
        extensions: ['.txt'],
        disabled: true,
        onImport: vi.fn(),
      },
    })();

    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'io-import-only:importer',
        disabled: true,
      }),
    );
    expect(registerExporter).not.toHaveBeenCalled();

    cleanup();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-import-only');
  });

  it('supports empty configs without registering importers or exporters', () => {
    const cleanup = createIOPlugin({ pluginId: 'io-empty' })();

    expect(registerImporter).not.toHaveBeenCalled();
    expect(registerExporter).not.toHaveBeenCalled();

    cleanup();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-empty');
  });
});

describe('createIOPluginStub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates disabled importer/exporter callbacks that reject with the phase message', async () => {
    const cleanup = createIOPluginStub({
      pluginId: 'io-dxf',
      formatName: 'DXF CAD',
      extensions: ['.dxf'],
      phase: 4,
    })();

    const importer = registerImporter.mock.calls[0]?.[0];
    const exporter = registerExporter.mock.calls[0]?.[0];

    expect(importer.disabled).toBe(true);
    expect(exporter.disabled).toBe(true);
    await expect(importer.onImport('', 'test.dxf')).rejects.toThrow('DXF CAD requires Phase 4');
    await expect(exporter.onExport(createEmptyProject('DXF Export'))).rejects.toThrow(
      'DXF CAD requires Phase 4',
    );

    cleanup();
  });

  it('defaults the stub message to Phase 3 when phase is omitted', async () => {
    createIOPluginStub({
      pluginId: 'io-stub',
      formatName: 'Future Format',
      extensions: ['.future'],
    })();

    const importer = registerImporter.mock.calls[0]?.[0];
    await expect(importer.onImport('', 'demo.future')).rejects.toThrow(
      'Future Format requires Phase 3',
    );
  });
});
