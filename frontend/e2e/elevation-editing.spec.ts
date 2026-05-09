/**
 * Elevation editing E2E tests.
 * Covers: add elevation point, delete elevation point, smooth elevation, undo/redo.
 */
import { test, expect, makeTestRoad, makeTestProject, injectProject, getProject } from './fixtures';

test.describe('Elevation Editing', () => {
  test.beforeEach(async ({ editorPage: page }) => {
    const road = {
      ...makeTestRoad('r1', 'Elevation Road', 200),
      elevation_profile: [
        { s: 0, a: 0, b: 0, c: 0, d: 0 },
        { s: 100, a: 5.0, b: 0, c: 0, d: 0 },
      ],
    };
    await injectProject(page, makeTestProject('Elevation Test', [road]));
    // Select the road
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().selectRoad('r1');
    });
  });

  test('displays elevation profile in PropertyPanel', async ({ editorPage: page }) => {
    // The elevation card should show count
    await expect(page.getByText(/高程.*\(2\)/)).toBeVisible({ timeout: 5000 });
  });

  test('add elevation point via store and verify count', async ({ editorPage: page }) => {
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().addElevationPoint('r1', 50, 2.5);
    });
    // Should now have 3 points
    await expect(page.getByText(/高程.*\(3\)/)).toBeVisible({ timeout: 5000 });
    // Verify project state
    const project = await getProject(page);
    const road = project.roads.find((r) => r.id === 'r1');
    expect(road?.elevation_profile).toHaveLength(3);
    // Points are sorted by s
    expect(road?.elevation_profile[1]?.s).toBe(50);
    expect(road?.elevation_profile[1]?.a).toBe(2.5);
  });

  test('remove elevation point and verify count', async ({ editorPage: page }) => {
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().removeElevationPoint('r1', 1);
    });
    await expect(page.getByText(/高程.*\(1\)/)).toBeVisible({ timeout: 5000 });
    const project = await getProject(page);
    expect(project.roads[0]?.elevation_profile).toHaveLength(1);
  });

  test('smooth elevation preserves point count', async ({ editorPage: page }) => {
    // Add a middle point to have 3 points for smoothing
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().addElevationPoint('r1', 50, 10);
      store.getState().smoothElevation('r1', 1);
    });
    const project = await getProject(page);
    expect(project.roads[0]?.elevation_profile).toHaveLength(3);
    // After smoothing, the middle point should have been adjusted
    const mid = project.roads[0]?.elevation_profile[1];
    expect(mid).toBeTruthy();
  });

  test('undo/redo elevation editing', async ({ editorPage: page }) => {
    // Add a point
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().addElevationPoint('r1', 50, 3.0);
    });

    let project = await getProject(page);
    expect(project.roads[0]?.elevation_profile).toHaveLength(3);

    // Undo
    await page.keyboard.press('Control+z');
    project = await getProject(page);
    expect(project.roads[0]?.elevation_profile).toHaveLength(2);

    // Redo
    await page.keyboard.press('Control+y');
    project = await getProject(page);
    expect(project.roads[0]?.elevation_profile).toHaveLength(3);
  });
});
