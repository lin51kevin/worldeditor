/**
 * GeoZ import & rendering E2E verification.
 *
 * Verifies that a GeoZ-produced project (with Line geometry and lane data)
 * can be processed by WASM to generate non-empty road vertices.
 */
import { test, expect, injectProject, getProject } from './fixtures';
import type { Project } from '../src/services/platform';

/**
 * Build a project matching the structure that the GeoZ parser produces.
 * Includes a road with Line geometry segments and a driving lane.
 */
function makeGeozProject(): Project {
  return {
    name: 'test.geoz',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: 'test',
      date: '2026-06-01',
      north: 50.0,
      south: 0.0,
      east: 100.0,
      west: 0.0,
      geo_reference: null,
    },
    roads: [
      {
        id: 'road-1',
        name: 'GeoZ Road 1',
        length: 100.0,
        junction_id: null,
        render_hidden: false,
        link: null,
        plan_view: [
          { s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 50.0, geo_type: 'Line' },
          { s: 50.0, x: 50.0, y: 0.0, hdg: 0.3, length: 50.0, geo_type: 'Line' },
        ],
        elevation_profile: [],
        lane_sections: [
          {
            s: 0.0,
            single_side: false,
            render_hidden: false,
            left: [
              {
                id: 1,
                lane_type: 'Driving',
                level: 0,
                render_hidden: false,
                link: null,
                width: [{ s_offset: 0, a: 3.75, b: 0, c: 0, d: 0 }],
                road_marks: [
                  { s_offset: 0, mark_type: 'solid', weight: 'standard', color: 'white', material: '', width: 0.15, lane_change: '' },
                ],
              },
            ],
            center: [
              { id: 0, lane_type: 'None', level: 0, render_hidden: false, link: null, width: [], road_marks: [] },
            ],
            right: [
              {
                id: -1,
                lane_type: 'Driving',
                level: 0,
                render_hidden: false,
                link: null,
                width: [{ s_offset: 0, a: 3.75, b: 0, c: 0, d: 0 }],
                road_marks: [
                  { s_offset: 0, mark_type: 'broken', weight: 'standard', color: 'white', material: '', width: 0.15, lane_change: '' },
                ],
              },
              {
                id: -2,
                lane_type: 'Shoulder',
                level: 0,
                render_hidden: false,
                link: null,
                width: [{ s_offset: 0, a: 2.0, b: 0, c: 0, d: 0 }],
                road_marks: [],
              },
            ],
          },
        ],
        lane_offsets: [],
        lateral_profile: { superelevations: [], crossfalls: [] },
        bridges: [],
        tunnels: [],
        signals: [],
        objects: [],
      },
    ],
    junctions: [],
    signals: [],
    objects: [],
  };
}

/**
 * Build a GeoZ-like project with NO lane sections (only reference line).
 * This tests the WASM fallback ribbon rendering path.
 */
function makeGeozProjectNoLanes(): Project {
  return {
    name: 'test-nolanes.geoz',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: 'test-nolanes',
      date: '2026-06-01',
      north: 10.0,
      south: 0.0,
      east: 50.0,
      west: 0.0,
      geo_reference: null,
    },
    roads: [
      {
        id: 'road-nolanes',
        name: 'NoLane Road',
        length: 50.0,
        junction_id: null,
        render_hidden: false,
        link: null,
        plan_view: [
          { s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 50.0, geo_type: 'Line' },
        ],
        elevation_profile: [],
        lane_sections: [],
        lane_offsets: [],
        lateral_profile: { superelevations: [], crossfalls: [] },
        bridges: [],
        tunnels: [],
        signals: [],
        objects: [],
      },
    ],
    junctions: [],
    signals: [],
    objects: [],
  };
}

test.describe('GeoZ Import & Render', () => {
  test('GeoZ project with lanes generates road vertices via WASM', async ({ editorPage: page }) => {
    const project = makeGeozProject();

    // Wait for the DEV bridge to be exposed (async import in main.tsx)
    await page.waitForFunction(
      () => !!(window as any).__projectStore && !!(window as any).__getPlatformService,
      { timeout: 10000 },
    );

    // Inject the GeoZ-like project into the store
    await injectProject(page, project);

    // Verify project is loaded correctly
    const loaded = await getProject(page);
    expect(loaded.roads).toHaveLength(1);
    expect(loaded.roads[0]!.name).toBe('GeoZ Road 1');

    // Verify WASM can generate non-empty road vertices from this project
    const vertexCount = await page.evaluate(async () => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      if (!getSvc) throw new Error('__getPlatformService not available');
      const svc = await getSvc();
      const store = (window as Record<string, any>).__projectStore;
      const proj = store.getState().project;
      const verts = await svc.generateRoadVertices(proj, 2.0, 'byLaneType');
      return verts.length;
    });

    // 7 floats per vertex (x,y,z,r,g,b,a), road should generate many vertices
    expect(vertexCount).toBeGreaterThan(0);
    expect(vertexCount % 7).toBe(0);
    const numVertices = vertexCount / 7;
    expect(numVertices).toBeGreaterThan(10);
  });

  test('GeoZ project without lane sections generates fallback ribbon', async ({ editorPage: page }) => {
    const project = makeGeozProjectNoLanes();

    await page.waitForFunction(
      () => !!(window as any).__projectStore && !!(window as any).__getPlatformService,
      { timeout: 10000 },
    );
    await injectProject(page, project);

    const loaded = await getProject(page);
    expect(loaded.roads).toHaveLength(1);
    expect(loaded.roads[0]!.lane_sections).toHaveLength(0);

    // WASM should generate a fallback ribbon for the road
    const vertexCount = await page.evaluate(async () => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      if (!getSvc) throw new Error('__getPlatformService not available');
      const svc = await getSvc();
      const store = (window as Record<string, any>).__projectStore;
      const proj = store.getState().project;
      const verts = await svc.generateRoadVertices(proj, 2.0, 'byLaneType');
      return verts.length;
    });

    expect(vertexCount).toBeGreaterThan(0);
    expect(vertexCount % 7).toBe(0);
  });

  test('GeoZ project renders visible content in viewport', async ({ editorPage: page }) => {
    const project = makeGeozProject();
    await page.waitForFunction(
      () => !!(window as any).__projectStore && !!(window as any).__getPlatformService,
      { timeout: 10000 },
    );
    await injectProject(page, project);

    // Verify the project was stored correctly
    const loaded = await getProject(page);
    expect(loaded.roads).toHaveLength(1);
    expect(loaded.roads[0]!.name).toBe('GeoZ Road 1');

    // Verify WASM can process the project (mesh generation)
    const vertexCount = await page.evaluate(async () => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      if (!getSvc) throw new Error('__getPlatformService not available');
      const svc = await getSvc();
      const store = (window as Record<string, any>).__projectStore;
      const proj = store.getState().project;
      const verts = await svc.generateRoadVertices(proj, 2.0, 'byLaneType');
      return verts.length;
    });
    expect(vertexCount).toBeGreaterThan(0);

    // Verify the layer panel shows the road name
    const roadItem = page.locator('.layer-item').filter({ hasText: 'GeoZ Road 1' });
    await expect(roadItem).toBeVisible({ timeout: 5000 });
  });

  test('GeoZ project with project-level signals does not break WASM', async ({ editorPage: page }) => {
    const project = makeGeozProject();
    // Add project-level signals (as the GeoZ parser would produce)
    (project as any).signals = [
      {
        id: 'signal-1',
        name: 'traffic_light',
        s: 25.0,
        t: 3.0,
        z_offset: 0.0,
        h_offset: 0.0,
        width: 1.0,
        height: 2.5,
        signal_type: 'traffic_light',
        signal_subtype: '-1',
        value: null,
        orientation: '+',
        is_dynamic: true,
      },
    ];

    await page.waitForFunction(
      () => !!(window as any).__projectStore && !!(window as any).__getPlatformService,
      { timeout: 10000 },
    );
    await injectProject(page, project);

    // Verify WASM still generates vertices (signals don't break deserialization)
    const vertexCount = await page.evaluate(async () => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      if (!getSvc) throw new Error('__getPlatformService not available');
      const svc = await getSvc();
      const store = (window as Record<string, any>).__projectStore;
      const proj = store.getState().project;
      const verts = await svc.generateRoadVertices(proj, 2.0, 'byLaneType');
      return verts.length;
    });

    expect(vertexCount).toBeGreaterThan(0);
  });
});
