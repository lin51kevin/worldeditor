import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockShowAlert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../utils/dialog', () => ({ showAlert: mockShowAlert }));
vi.mock('../../core/emptyProject', () => ({ createEmptyProject: vi.fn(() => ({ roads: [], junctions: [] })) }));
const rp = vi.fn(), ri = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerImporter: ri, unregisterPlugin: u })) } }));
import { mountModels3dPlugin } from './models-3d-beta.plugin';
describe('models-3d-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountModels3dPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountModels3dPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers importer with .obj', () => { const c = mountModels3dPlugin(); expect(ri.mock.calls[0]?.[0].extensions).toContain('.obj'); c(); });
  it('unregisters', () => { const c = mountModels3dPlugin(); c(); expect(u).toHaveBeenCalledWith('3d-models'); });
  it('panel component renders a placeholder message', () => {
    mountModels3dPlugin();
    const panelCall = rp.mock.calls[0]?.[0];
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(createElement(panelCall.component));
    expect(html).toContain('coming soon');
  });
  it('importer onImport shows alert and returns empty project', async () => {
    mountModels3dPlugin();
    const importerCall = ri.mock.calls[0]?.[0];
    const result = await importerCall.onImport();
    expect(mockShowAlert).toHaveBeenCalled();
    expect(result).toEqual({ roads: [], junctions: [] });
  });
});
