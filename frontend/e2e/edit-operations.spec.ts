/**
 * Edit operations E2E verification.
 */
import { test, expect } from '@playwright/test';

test.describe('Edit Operations', () => {
  test('property panel shows no selection initially', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.property-empty')).toBeVisible({ timeout: 10000 });
  });

  test('road name input appears when road selected', async ({ page }) => {
    await page.goto('/');
    // Load a project with roads via the __editorStore bridge
    await page.evaluate(() => {
      const store = (window as any).__editorStore;
      if (store) {
        store.getState().addRoad({
          id: 'r1', name: 'Test Road', length: 100, junction_id: null,
          link: { predecessor: null, successor: null },
          plan_view: [], lane_sections: [], elevation_profile: [],
        });
        store.getState().selectRoad('r1');
      }
    });
    await expect(page.locator('.property-input')).toBeVisible({ timeout: 5000 });
  });
});
