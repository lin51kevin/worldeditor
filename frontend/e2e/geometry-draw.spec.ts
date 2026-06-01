/**
 * Geometry draw tools E2E tests.
 *
 * Tests the Line, Arc, and Spiral drawing tools:
 * - Toolbar buttons activate the correct draw mode
 * - Drawing points accumulate correctly in the store
 * - After required points, a road is created with the correct geometry type
 * - Escape clears current draw points without creating a road
 *
 * NOTE: WebGPU is not available in headless Chromium, so viewport clicks
 * cannot produce world coordinates. We test the store-level logic directly
 * and verify toolbar UI interactions work correctly.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Helper: wait for the app to load and toolbar to be visible. */
async function setupPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('.toolbar', { timeout: 10000 });
  // Wait for geometry builder to be exposed on window
  await page.waitForFunction(() => !!(window as any).__geometryBuilder, { timeout: 5000 });
}

/** Helper: get current editMode from the view store. */
async function getEditMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as any).__editorViewStore;
    return store.getState().editMode;
  });
}

/** Helper: get current drawPoints from the view store. */
async function getDrawPoints(page: Page): Promise<Array<[number, number, number]>> {
  return page.evaluate(() => {
    const store = (window as any).__editorViewStore;
    return store.getState().drawPoints;
  });
}

/** Helper: get number of roads in the project. */
async function getRoadCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as any).__projectStore;
    return store.getState().project.roads.length;
  });
}

/** Helper: get the last created road from the project. */
async function getLastRoad(page: Page): Promise<any> {
  return page.evaluate(() => {
    const store = (window as any).__projectStore;
    const roads = store.getState().project.roads;
    return roads.length > 0 ? roads[roads.length - 1] : null;
  });
}

/** Helper: get selectedRoadId from the editor store. */
async function getSelectedRoadId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as any).__projectStore;
    return store.getState().selectedRoadId;
  });
}

/** Helper: click the toolbar button for a draw tool by title attribute. */
async function clickDrawToolButton(page: Page, toolTitle: string): Promise<void> {
  await page.locator(`.toolbar-btn[title="${toolTitle}"]`).click();
}

/** Helper: set editMode programmatically. */
async function setEditMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((m) => {
    const store = (window as any).__editorViewStore;
    store.getState().setEditMode(m);
  }, mode);
}

/** Helper: append a draw point programmatically (simulates what handleClick does). */
async function appendDrawPoint(page: Page, x: number, y: number, z = 0): Promise<void> {
  await page.evaluate(({ x, y, z }) => {
    const store = (window as any).__editorViewStore;
    store.getState().appendDrawPoint([x, y, z]);
  }, { x, y, z });
}

/** Helper: clear draw points. */
async function clearDrawPoints(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__editorViewStore;
    store.getState().clearDrawPoints();
  });
}

/**
 * Helper: simulate the complete draw flow as Viewport.handleClick does:
 * append point, check if enough points, finalize road creation if so.
 *
 * Mirrors the logic in Viewport.tsx handleClick + finalizeDrawGeometry.
 */
async function simulateDrawClick(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const viewStore = (window as any).__editorViewStore;
    const editorStore = (window as any).__projectStore;
    const geomBuilder = (window as any).__geometryBuilder;
    const state = viewStore.getState();

    const point: [number, number, number] = [x, y, 0];
    const nextPoints = [...state.drawPoints, point];
    state.appendDrawPoint(point);

    const requiredPoints = state.editMode === 'draw-arc' ? 3 : 2;
    if (nextPoints.length >= requiredPoints) {
      // Generate road ID same way as Viewport.tsx nextSplineRoadId
      const existingIds = new Set(editorStore.getState().project.roads.map((r: any) => r.id));
      let index = editorStore.getState().project.roads.length + 1;
      let roadId = `road_spline_${index}`;
      while (existingIds.has(roadId)) {
        index += 1;
        roadId = `road_spline_${index}`;
      }

      let geometry;
      if (state.editMode === 'draw-line') {
        geometry = geomBuilder.buildLineGeometry(nextPoints[0], nextPoints[1]);
      } else if (state.editMode === 'draw-arc') {
        geometry = geomBuilder.buildArcGeometry(nextPoints[0], nextPoints[1], nextPoints[2]);
      } else {
        geometry = geomBuilder.buildSpiralGeometry(nextPoints[0], nextPoints[1]);
      }

      const road = geomBuilder.buildRoadFromGeometry(roadId, geometry);
      editorStore.getState().addRoad(road);
      editorStore.getState().selectRoad(roadId);
      viewStore.getState().clearDrawPoints();
    }
  }, { x, y });
}

test.describe('Geometry Draw Tools', () => {
  test.describe('Toolbar activation', () => {
    test('draw-line button sets editMode to draw-line', async ({ page }) => {
      await setupPage(page);
      await clickDrawToolButton(page, '绘制直线道路（点击2个点）');
      expect(await getEditMode(page)).toBe('draw-line');
    });

    test('draw-arc button sets editMode to draw-arc', async ({ page }) => {
      await setupPage(page);
      await clickDrawToolButton(page, '绘制圆弧道路（点击3个点：起点、途经点、终点）');
      expect(await getEditMode(page)).toBe('draw-arc');
    });

    test('draw-spiral button sets editMode to draw-spiral', async ({ page }) => {
      await setupPage(page);
      await clickDrawToolButton(page, '绘制回旋线道路（点击2个点）');
      expect(await getEditMode(page)).toBe('draw-spiral');
    });

    test('draw buttons have active class when selected', async ({ page }) => {
      await setupPage(page);
      await clickDrawToolButton(page, '绘制直线道路（点击2个点）');
      const btn = page.locator('.toolbar-btn[title="绘制直线道路（点击2个点）"]');
      await expect(btn).toHaveClass(/active/);
    });

    test('switching between draw tools clears drawPoints', async ({ page }) => {
      await setupPage(page);
      // Enter draw-line mode and add a point
      await setEditMode(page, 'draw-line');
      await appendDrawPoint(page, 10, 20);
      expect(await getDrawPoints(page)).toHaveLength(1);

      // Switch to draw-arc — points should be cleared
      await clickDrawToolButton(page, '绘制圆弧道路（点击3个点：起点、途经点、终点）');
      expect(await getDrawPoints(page)).toHaveLength(0);
    });

    test('switching to select mode clears drawPoints', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await appendDrawPoint(page, 10, 20);
      expect(await getDrawPoints(page)).toHaveLength(1);

      // Switch to select mode
      await page.locator('.toolbar-btn[title="选择模式 (S)"]').click();
      expect(await getDrawPoints(page)).toHaveLength(0);
      expect(await getEditMode(page)).toBe('select');
    });
  });

  test.describe('Draw points accumulation', () => {
    test('appendDrawPoint adds points to store', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');

      await appendDrawPoint(page, 10, 20);
      const points1 = await getDrawPoints(page);
      expect(points1).toHaveLength(1);
      expect(points1[0]).toEqual([10, 20, 0]);

      await appendDrawPoint(page, 30, 40);
      const points2 = await getDrawPoints(page);
      expect(points2).toHaveLength(2);
      expect(points2[1]).toEqual([30, 40, 0]);
    });

    test('clearDrawPoints resets the array', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await appendDrawPoint(page, 10, 20);
      await appendDrawPoint(page, 30, 40);
      expect(await getDrawPoints(page)).toHaveLength(2);

      await clearDrawPoints(page);
      expect(await getDrawPoints(page)).toHaveLength(0);
    });
  });

  test.describe('Draw Line — store-level simulation', () => {
    test('two points creates a road with Line geometry', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);

      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 0, 0);

      // After first point: 1 draw point, no road created
      expect(await getDrawPoints(page)).toHaveLength(1);
      expect(await getRoadCount(page)).toBe(initialRoads);

      await simulateDrawClick(page, 100, 0);

      // After second point: road created, draw points cleared
      expect(await getRoadCount(page)).toBe(initialRoads + 1);
      expect(await getDrawPoints(page)).toHaveLength(0);

      const road = await getLastRoad(page);
      expect(road).not.toBeNull();
      expect(road.plan_view).toHaveLength(1);
      expect(road.plan_view[0].geo_type).toBe('Line');
      expect(road.plan_view[0].length).toBeCloseTo(100, 0);
    });

    test('created road has correct start position and heading', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 50, 100);
      await simulateDrawClick(page, 150, 100);

      const road = await getLastRoad(page);
      expect(road.plan_view[0].x).toBeCloseTo(50, 1);
      expect(road.plan_view[0].y).toBeCloseTo(100, 1);
      expect(road.plan_view[0].hdg).toBeCloseTo(0, 2); // heading along +X
    });

    test('can create multiple roads sequentially', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);
      await setEditMode(page, 'draw-line');

      // First road
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 100, 0);
      expect(await getRoadCount(page)).toBe(initialRoads + 1);

      // Second road — mode should stay draw-line
      expect(await getEditMode(page)).toBe('draw-line');
      await simulateDrawClick(page, 0, 50);
      await simulateDrawClick(page, 100, 50);
      expect(await getRoadCount(page)).toBe(initialRoads + 2);
    });

    test('road is auto-selected after creation', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 100, 0);

      const selectedId = await getSelectedRoadId(page);
      expect(selectedId).not.toBeNull();
    });
  });

  test.describe('Draw Arc — store-level simulation', () => {
    test('three points creates a road with Arc geometry', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);

      await setEditMode(page, 'draw-arc');
      await simulateDrawClick(page, 0, 0);
      expect(await getDrawPoints(page)).toHaveLength(1);
      expect(await getRoadCount(page)).toBe(initialRoads);

      await simulateDrawClick(page, 50, 50);
      expect(await getDrawPoints(page)).toHaveLength(2);
      expect(await getRoadCount(page)).toBe(initialRoads);

      await simulateDrawClick(page, 100, 0);
      expect(await getRoadCount(page)).toBe(initialRoads + 1);
      expect(await getDrawPoints(page)).toHaveLength(0);

      const road = await getLastRoad(page);
      expect(road.plan_view).toHaveLength(1);
      expect(road.plan_view[0].geo_type).toHaveProperty('Arc');
      expect(road.plan_view[0].geo_type.Arc.curvature).not.toBe(0);
      expect(road.plan_view[0].length).toBeGreaterThan(0);
    });

    test('collinear points produce Line fallback', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-arc');
      // Three collinear points
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 50, 0);
      await simulateDrawClick(page, 100, 0);

      const road = await getLastRoad(page);
      // Collinear → falls back to Line
      expect(road.plan_view[0].geo_type).toBe('Line');
    });
  });

  test.describe('Draw Spiral — store-level simulation', () => {
    test('two points creates a road with Spiral geometry', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);

      await setEditMode(page, 'draw-spiral');
      await simulateDrawClick(page, 0, 0);
      expect(await getDrawPoints(page)).toHaveLength(1);

      await simulateDrawClick(page, 100, 50);
      expect(await getRoadCount(page)).toBe(initialRoads + 1);
      expect(await getDrawPoints(page)).toHaveLength(0);

      const road = await getLastRoad(page);
      expect(road.plan_view).toHaveLength(1);
      expect(road.plan_view[0].geo_type).toHaveProperty('Spiral');
      expect(road.plan_view[0].geo_type.Spiral.curv_start).toBe(0);
      expect(road.plan_view[0].geo_type.Spiral.curv_end).not.toBe(0);
    });
  });

  test.describe('Escape cancels drawing', () => {
    test('escape clears draw points without creating road', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);

      await setEditMode(page, 'draw-line');
      await appendDrawPoint(page, 50, 50);
      expect(await getDrawPoints(page)).toHaveLength(1);

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      expect(await getDrawPoints(page)).toHaveLength(0);
      expect(await getRoadCount(page)).toBe(initialRoads);
    });

    test('escape in draw-arc mode with 2 points clears without creating road', async ({ page }) => {
      await setupPage(page);
      const initialRoads = await getRoadCount(page);

      await setEditMode(page, 'draw-arc');
      await appendDrawPoint(page, 0, 0);
      await appendDrawPoint(page, 50, 50);
      expect(await getDrawPoints(page)).toHaveLength(2);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      expect(await getDrawPoints(page)).toHaveLength(0);
      expect(await getRoadCount(page)).toBe(initialRoads);
    });

    test('mode stays in draw mode after escape', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await appendDrawPoint(page, 50, 50);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // Mode should remain draw-line (not switch to select)
      expect(await getEditMode(page)).toBe('draw-line');
    });
  });

  test.describe('Road properties', () => {
    test('created line road has default lane sections', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 200, 0);

      const road = await getLastRoad(page);
      expect(road.lane_sections).toHaveLength(1);
      expect(road.lane_sections[0].left.length).toBeGreaterThanOrEqual(1);
      expect(road.lane_sections[0].right.length).toBeGreaterThanOrEqual(1);
    });

    test('created road has elevation profile', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 100, 0);

      const road = await getLastRoad(page);
      expect(road.elevation_profile).toHaveLength(1);
      expect(road.elevation_profile[0].s).toBe(0);
    });

    test('road length matches geometry length', async ({ page }) => {
      await setupPage(page);
      await setEditMode(page, 'draw-line');
      await simulateDrawClick(page, 0, 0);
      await simulateDrawClick(page, 100, 0);

      const road = await getLastRoad(page);
      expect(road.length).toBeCloseTo(road.plan_view[0].length, 5);
    });
  });
});
