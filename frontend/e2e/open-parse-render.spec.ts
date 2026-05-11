import { test, expect, readXodrFixture, openXodrInBrowser, getProject } from './fixtures';

test.describe('Open & Parse & Render', () => {
  test('single_road.xodr — parse and display road in layer panel', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    // Verify project loaded in toolbar
    const title1 = await page.locator('.toolbar-title').textContent();
    expect(title1).toContain('single_road.xodr');

    // Verify road appears in layer panel
    const roadItem = page.locator('.layer-item').filter({ hasText: 'MainStreet' });
    await expect(roadItem).toBeVisible();

    // Verify status bar shows correct road count
    await expect(page.locator('.statusbar')).toContainText('道路: 1');
  });

  test('single_road.xodr — parsed project has correct structure', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    const project = await getProject(page);

    expect(project.roads).toHaveLength(1);
    const road = project.roads[0]!;
    expect(road.id).toBe('1');
    expect(road.name).toBe('MainStreet');
    expect(road.length).toBeCloseTo(100.0);

    // Geometry segments
    expect(road.plan_view).toHaveLength(3);
    expect(road.plan_view[0]!.geo_type).toBe('Line');

    // Elevation
    expect(road.elevation_profile).toHaveLength(2);

    // Lane sections
    expect(road.lane_sections).toHaveLength(2);
    const ls0 = road.lane_sections[0]!;
    expect(ls0.left).toHaveLength(2);
    expect(ls0.center).toHaveLength(1);
    expect(ls0.right).toHaveLength(2);
  });

  test('single_road.xodr — clicking road shows properties', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    // Click the road in layer panel
    const roadItem = page.locator('.layer-item').filter({ hasText: 'MainStreet' });
    await roadItem.click();

    // Properties panel should show road details
    const props = page.locator('.property-panel');
    await expect(props.locator('input.property-input').first()).toHaveValue('MainStreet');
    await expect(props).toContainText('100');// length
  });

  test('junction.xodr — parse multiple roads and junction', async ({ editorPage: page }) => {
    const xml = readXodrFixture('junction.xodr');
    await openXodrInBrowser(page, xml, 'junction.xodr');

    // Verify toolbar title
    const title2 = await page.locator('.toolbar-title').textContent();
    expect(title2).toContain('junction.xodr');

    // Verify 3 roads in layer panel
    await expect(page.locator('.statusbar')).toContainText('道路: 3');
    await expect(page.locator('.statusbar')).toContainText('路口: 1');

    // Verify all road names
    await expect(page.locator('.layer-item').filter({ hasText: 'NorthSouth' })).toBeVisible();
    await expect(page.locator('.layer-item').filter({ hasText: 'EastWest' })).toBeVisible();
    await expect(page.locator('.layer-item').filter({ hasText: 'ConnectingRoad' })).toBeVisible();

    // Verify project data
    const project = await getProject(page);
    expect(project.roads).toHaveLength(3);
    expect(project.junctions).toHaveLength(1);
    expect(project.junctions[0]!.name).toBe('MainJunction');
    expect(project.junctions[0]!.connections).toHaveLength(2);
  });

  test('single_road.xodr — viewport canvas renders (non-blank)', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    // Wait a moment for WASM mesh generation + WebGPU render
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas.viewport-canvas');
    await expect(canvas).toBeVisible();

    // Check canvas has non-zero dimensions
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);

    // Sample pixels from the canvas to verify it rendered something
    // (WebGPU may not be available in headless Chromium — so we check
    //  either WebGPU rendered non-black content OR the fallback overlay shows)
    const overlay = page.locator('.viewport-overlay');
    const hasWebGPU = !(await overlay.isVisible());

    if (hasWebGPU) {
      // WebGPU available — canvas should have non-uniform pixel data
      const isNotBlank = await page.evaluate(() => {
        const canvas = document.querySelector('canvas.viewport-canvas') as HTMLCanvasElement | null;
        if (!canvas) return false;
        // Sample via 2D context copy
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(canvas, 0, 0);
        const data = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100)).data;
        // Check if any pixel is not the clear color (approx 0.12*255=31)
        let nonClear = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
          if (r > 40 || g > 40 || b > 40) nonClear++;
        }
        return nonClear > 10; // at least some non-background pixels
      });
      expect(isNotBlank).toBe(true);
    }
    // If no WebGPU, we still pass — fallback overlay is shown, tested elsewhere
  });

  test('roundtrip — parse then write preserves structure', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');

    // Write back to XML via WASM
    const rewritten = await page.evaluate(async () => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      const svc = await getSvc();
      const store = (window as Record<string, any>).__editorStore;
      const project = store.getState().project;
      return await svc.writeOpenDrive(project);
    });

    expect(rewritten).toContain('<OpenDRIVE');
    expect(rewritten).toContain('MainStreet');
    expect(rewritten).toContain('<line');
    expect(rewritten).toContain('<arc');
    expect(rewritten).toContain('<spiral');

    // Re-parse the rewritten XML and compare
    const reparsed = await page.evaluate(async (xmlStr: string) => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      const svc = await getSvc();
      return await svc.parseOpenDrive(xmlStr);
    }, rewritten);

    expect(reparsed.roads).toHaveLength(1);
    expect(reparsed.roads[0].name).toBe('MainStreet');
    expect(reparsed.roads[0].plan_view).toHaveLength(3);
    expect(reparsed.roads[0].lane_sections).toHaveLength(2);
  });
});
