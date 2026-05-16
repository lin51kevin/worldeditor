import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountGisToolsPlugin } from './gisTools.plugin';
import { mountValidationPlugin } from './validation.plugin';
import { mountTrafficPlugin } from './traffic.plugin';
import { mountPointcloudPlugin } from './pointcloud-beta.plugin';
import { mountModels3dPlugin } from './models-3d-beta.plugin';
import { mountSatellitePlugin } from './satellite-beta.plugin';
import { mountScriptingPlugin } from './scripting-beta.plugin';
import { mountEcosystemPlugin } from './ecosystem-beta.plugin';
import { mountLaneDetectPlugin } from './lane-detect-beta.plugin';
import { mountConverterPlugin } from './converter.plugin';
import { createEmptyProject } from './emptyProject';

const { mockShowAlert, registered, mockUnregister } = vi.hoisted(() => {
  return {
    mockShowAlert: vi.fn().mockResolvedValue(undefined),
    registered: [] as { type: string; data: unknown }[],
    mockUnregister: vi.fn(),
  };
});

vi.mock('../utils/dialog', () => ({ showAlert: mockShowAlert }));
vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => {
      const cap = (t: string) => (d: unknown) => registered.push({ type: t, data: d });
      return {
        registerPanel: cap('panel'), registerMenuItem: cap('menuItem'),
        registerImporter: cap('importer'), registerExporter: cap('exporter'),
        unregisterPlugin: mockUnregister,
      };
    }),
  },
}));

function reg(): { type: string; data: unknown }[] { return registered; }

interface PluginDef { name: string; mount: () => () => void; pluginId: string }
const plugins: PluginDef[] = [
  { name: 'gisTools', mount: mountGisToolsPlugin, pluginId: 'gis-tools' },
  { name: 'validation', mount: mountValidationPlugin, pluginId: 'validation' },
  { name: 'traffic', mount: mountTrafficPlugin, pluginId: 'traffic' },
  { name: 'pointcloud', mount: mountPointcloudPlugin, pluginId: 'pointcloud' },
  { name: 'models3d', mount: mountModels3dPlugin, pluginId: '3d-models' },
  { name: 'satellite', mount: mountSatellitePlugin, pluginId: 'satellite' },
  { name: 'scripting', mount: mountScriptingPlugin, pluginId: 'scripting' },
  { name: 'ecosystem', mount: mountEcosystemPlugin, pluginId: 'ecosystem' },
  { name: 'laneDetect', mount: mountLaneDetectPlugin, pluginId: 'lane-detect' },
  { name: 'converter', mount: mountConverterPlugin, pluginId: 'converter' },
];

describe('stub plugins — mount, register, and showAlert on click', () => {
  beforeEach(() => { vi.clearAllMocks(); registered.length = 0; mockShowAlert.mockResolvedValue(undefined); });

  for (const p of plugins) {
    describe(`${p.name}`, () => {
      it('mounts and unregisters without error', () => {
        const cleanup = p.mount();
        expect(typeof cleanup).toBe('function');
        cleanup();
        expect(mockUnregister).toHaveBeenCalledWith(p.pluginId);
      });

      it('registers contributions', () => {
        p.mount();
        expect(reg().length).toBeGreaterThanOrEqual(1);
      });

      it('showAlert is called on menu item click (no rejection)', async () => {
        p.mount();
        const items = reg().filter(r => r.type === 'menuItem') as { data: { onClick: () => unknown } }[];
        if (items.length === 0) return; // skip plugins without menu items (e.g. pointcloud)
        for (const item of items) {
          const result = item.data.onClick();
          if (result instanceof Promise) await result;
        }
        expect(mockShowAlert).toHaveBeenCalled();
      });
    });
  }

  it('traffic SUMO importer returns project + showAlert', async () => {
    mountTrafficPlugin();
    const imp = reg().find(r => r.type === 'importer')!.data as { onImport: () => Promise<unknown> };
    const result = await imp.onImport();
    expect(result).toHaveProperty('roads');
    expect(mockShowAlert).toHaveBeenCalled();
  });

  it('traffic SUMO exporter calls showAlert', async () => {
    mountTrafficPlugin();
    const exp = reg().find(r => r.type === 'exporter')!.data as { onExport: () => Promise<unknown> };
    await expect(exp.onExport()).resolves.toBeUndefined();
    expect(mockShowAlert).toHaveBeenCalled();
  });

  it('pointcloud importer returns project + showAlert', async () => {
    mountPointcloudPlugin();
    const imp = reg().find(r => r.type === 'importer')!.data as { onImport: () => Promise<unknown> };
    const result = await imp.onImport();
    expect(result).toHaveProperty('roads');
    expect(mockShowAlert).toHaveBeenCalled();
  });

  it('models3d importer returns project + showAlert', async () => {
    mountModels3dPlugin();
    const imp = reg().find(r => r.type === 'importer')!.data as { onImport: () => Promise<unknown> };
    const result = await imp.onImport();
    expect(result).toHaveProperty('roads');
    expect(mockShowAlert).toHaveBeenCalled();
  });

  it('laneDetect onClick returns void (not a promise)', async () => {
    mountLaneDetectPlugin();
    const item = reg().filter(r => r.type === 'menuItem')[0]!.data as { onClick: () => unknown };
    const result = item.onClick();
    expect(result).toBeUndefined();
  });

  it('createEmptyProject returns valid project stub', () => {
    const p = createEmptyProject('Test');
    expect(p.name).toBe('Test');
    expect(p.roads).toEqual([]);
    expect(p.header.rev_major).toBe(1);
  });
});
