/**
 * Solid-mode initial render verification.
 *
 * Regression coverage for two bugs:
 *   1. Opening an xodr did not render road surfaces in solid mode until the user
 *      toggled wire/sketch → solid (the per-road incremental upload seeded empty
 *      buffers on the first frame).
 *   2. Some GeoZ projects rendered only junctions, no road surfaces.
 *
 * Both are checked directly against the live renderer's road-surface buffer
 * count (`getRoadMeshCount`) so a green result means real GPU buffers exist —
 * no manual eyeballing, no wire→solid toggle.
 */
import { test, expect, readXodrFixture, openXodrInBrowser, injectProject } from './fixtures';
import type { Project } from '../src/services/platform';

/** Default view mode must be solid for these assertions to be meaningful. */
async function isSolidMode(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const vs = (window as Record<string, any>).__viewportStore;
    return vs?.getState().viewMode === 'solid';
  });
}

/** Returns the live renderer's road-surface mesh count, or -1 if no renderer. */
async function roadMeshCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const get = (window as Record<string, any>).__getViewportRenderer;
    const r = get?.();
    return r && typeof r.getRoadMeshCount === 'function' ? r.getRoadMeshCount() : -1;
  });
}

/** Skip if WebGPU is unavailable (renderer never initializes). */
async function skipIfNoRenderer(page: import('@playwright/test').Page): Promise<boolean> {
  await page.waitForFunction(() => !!(window as any).__getViewportRenderer, { timeout: 10000 });
  return (await roadMeshCount(page)) === -1
    ? ((await page.locator('.viewport-overlay').isVisible()) ? true : false)
    : false;
}

function makeGeozProject(): Project {
  return {
    name: 'render.geoz',
    header: { rev_major: 1, rev_minor: 6, name: 'render', date: '2026-06-01', north: 60, south: 0, east: 120, west: 0, geo_reference: null },
    roads: [
      {
        id: 'road-1', name: 'GeoZ Road 1', length: 100, junction_id: null, render_hidden: false, link: null,
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
        elevation_profile: [],
        lane_sections: [{
          s: 0, single_side: false, render_hidden: false,
          left: [{ id: 1, lane_type: 'Driving', level: 0, render_hidden: false, link: null, width: [{ s_offset: 0, a: 3.75, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [{ id: 0, lane_type: 'None', level: 0, render_hidden: false, link: null, width: [], road_marks: [] }],
          right: [{ id: -1, lane_type: 'Driving', level: 0, render_hidden: false, link: null, width: [{ s_offset: 0, a: 3.75, b: 0, c: 0, d: 0 }], road_marks: [] }],
        }],
        lane_offsets: [], lateral_profile: { superelevations: [], crossfalls: [] }, bridges: [], tunnels: [], signals: [], objects: [],
      },
    ],
    junctions: [], signals: [], objects: [],
  };
}

test.describe('Solid-mode initial render', () => {
  test('xodr renders road surfaces in solid mode without any toggle (bug1)', async ({ editorPage: page }) => {
    if (await skipIfNoRenderer(page)) test.skip(true, 'WebGPU unavailable');
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    expect(await isSolidMode(page)).toBe(true);
    // Surfaces must appear on the first solid frame — NO wire→solid toggle.
    await expect.poll(() => roadMeshCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  });

  test('geoz renders road surfaces, not only junctions (bug2)', async ({ editorPage: page }) => {
    if (await skipIfNoRenderer(page)) test.skip(true, 'WebGPU unavailable');
    await injectProject(page, makeGeozProject());

    expect(await isSolidMode(page)).toBe(true);
    await expect.poll(() => roadMeshCount(page), { timeout: 8000 }).toBeGreaterThan(0);
  });
});
