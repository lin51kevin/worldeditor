/**
 * Tests for the external plugin bootstrap and the generated io-csv bundle.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapExternalPlugins } from './externalBootstrap';
import { scanPluginSource } from './sandboxGuard';

describe('bootstrapExternalPlugins', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('is a no-op outside the Tauri runtime and returns a callable cleanup', async () => {
    expect('__TAURI_INTERNALS__' in window).toBe(false);
    const cleanup = await bootstrapExternalPlugins();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});

describe('generated external bundles', () => {
  // Built by scripts/build-plugins.mjs → repo-root plugins/<id>/dist/index.js.
  const pluginsRoot = resolve(__dirname, '../../../../plugins');
  const ids = [
    'io-csv', 'io-obj3d', 'io-osm', 'io-dxf', 'io-mif',
    'io-lanelet2', 'io-xodr-ext', 'io-nio', 'io-shapefile', 'io-signals',
    'gis-tools', 'validation', 'traffic', 'converter',
  ];

  for (const id of ids) {
    const bundlePath = resolve(pluginsRoot, id, 'dist/index.js');
    it.runIf(existsSync(bundlePath))(
      `${id} passes the sandbox guard with zero violations`,
      () => {
        const source = readFileSync(bundlePath, 'utf8');
        const violations = scanPluginSource(source);
        expect(violations).toEqual([]);
      },
    );
  }
});
