import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockShowAlert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../utils/dialog', () => ({ showAlert: mockShowAlert }));
const rp = vi.fn(), rm = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, unregisterPlugin: u })) } }));
import { mountEcosystemPlugin } from './ecosystem-beta.plugin';
describe('ecosystem-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountEcosystemPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountEcosystemPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountEcosystemPlugin(); c(); expect(u).toHaveBeenCalledWith('ecosystem-beta'); });
  it('panel component renders a placeholder message', () => {
    mountEcosystemPlugin();
    const panelCall = rp.mock.calls[0]?.[0];
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(createElement(panelCall.component));
    expect(html).toContain('coming soon');
  });
  it('menu item onClick shows alert', () => {
    mountEcosystemPlugin();
    const menuCall = rm.mock.calls[0]?.[0];
    menuCall.onClick();
    expect(mockShowAlert).toHaveBeenCalled();
  });
});
