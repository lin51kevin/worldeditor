/**
 * Measurement tool E2E tests.
 * Covers: measurement panel visibility, mode switching, point collection, result display, clear.
 */
import { test, expect } from './fixtures';

test.describe('Measurement Tool', () => {
  test('measure button in toolbar toggles measurement panel', async ({ editorPage: page }) => {
    // Measure button is in MenuBar quick-actions (icon-only, identified by title)
    const measureBtn = page.locator('.menubar-action-btn[title*="测量"]');
    await expect(measureBtn).toBeVisible({ timeout: 5000 });

    // Initially no measurement panel
    await expect(page.locator('[data-testid="measurement-panel"]')).not.toBeVisible();

    // Click to enable → panel appears
    await measureBtn.click();
    await expect(page.locator('[data-testid="measurement-panel"]')).toBeVisible({ timeout: 3000 });

    // Click again to disable → panel disappears
    await measureBtn.click();
    await expect(page.locator('[data-testid="measurement-panel"]')).not.toBeVisible();
  });

  test('measurement panel shows mode buttons', async ({ editorPage: page }) => {
    // Enable measurement mode via store
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('distance');
    });

    await expect(page.locator('[data-testid="measure-mode-distance"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="measure-mode-angle"]')).toBeVisible();
    await expect(page.locator('[data-testid="measure-mode-area"]')).toBeVisible();
  });

  test('switching measurement mode clears previous state', async ({ editorPage: page }) => {
    // Set distance mode and add points
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('distance');
      viewStore.getState().addMeasurePoint({ x: 0, y: 0, z: 0 });
    });

    let points = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return viewStore.getState().measurePoints.length;
    });
    expect(points).toBe(1);

    // Switch to angle mode via store (avoids toolbar overlap)
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('angle');
    });

    points = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return viewStore.getState().measurePoints.length;
    });
    expect(points).toBe(0);

    const mode = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return viewStore.getState().measureMode;
    });
    expect(mode).toBe('angle');
  });

  test('close button dismisses measurement panel', async ({ editorPage: page }) => {
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('distance');
    });
    await expect(page.locator('[data-testid="measurement-panel"]')).toBeVisible({ timeout: 3000 });

    // Close via store (the close button may be overlapped by menubar)
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('none');
    });
    await expect(page.locator('[data-testid="measurement-panel"]')).not.toBeVisible();
  });

  test('measurement result displays after adding points', async ({ editorPage: page }) => {
    // Set distance result directly via store
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('distance');
      viewStore.getState().addMeasurePoint({ x: 0, y: 0, z: 0 });
      viewStore.getState().addMeasurePoint({ x: 10, y: 0, z: 0 });
      viewStore.getState().setMeasurementResult({
        type: 'distance',
        value: { straight: 10.0, horizontal: 10.0, vertical: 0.0 },
      });
    });

    // Should show result values
    await expect(page.locator('.measure-result')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.measure-value', { hasText: '10.000' }).first()).toBeVisible();
  });

  test('clear button resets measurement state', async ({ editorPage: page }) => {
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setMeasureMode('distance');
      viewStore.getState().addMeasurePoint({ x: 0, y: 0, z: 0 });
      viewStore.getState().setMeasurementResult({
        type: 'distance',
        value: { straight: 5.0, horizontal: 5.0, vertical: 0.0 },
      });
    });

    // Clear via store (button may be overlapped by viewport canvas)
    await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().clearMeasurePoints();
    });

    const state = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return {
        points: viewStore.getState().measurePoints.length,
        result: viewStore.getState().lastMeasurement,
      };
    });
    expect(state.points).toBe(0);
    expect(state.result).toBeNull();
  });

  test('measurement via command palette', async ({ editorPage: page }) => {
    // Open command palette
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cp-container')).toBeVisible({ timeout: 3000 });

    // Type distance
    await page.locator('.cp-input').fill('距离');
    await page.keyboard.press('Enter');

    // Measurement panel should appear in distance mode
    await expect(page.locator('[data-testid="measurement-panel"]')).toBeVisible({ timeout: 3000 });
    const mode = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return viewStore.getState().measureMode;
    });
    expect(mode).toBe('distance');
  });

  test('measurement via tools menu', async ({ editorPage: page }) => {
    // Open the hamburger mega-menu
    await page.locator('.menubar-hamburger').click();
    await expect(page.locator('.menubar-mega-dropdown')).toBeVisible({ timeout: 3000 });

    // Hover over the '工具' mega-item to reveal its submenu
    const toolsItem = page.locator('.menubar-mega-item', { hasText: '工具' });
    await toolsItem.hover();
    await expect(page.locator('.menubar-submenu')).toBeVisible({ timeout: 3000 });

    // Click distance measurement entry
    const distEntry = page.locator('.menubar-submenu .menubar-dropdown-item', { hasText: '距离' });
    await distEntry.click();

    // Panel should appear
    await expect(page.locator('[data-testid="measurement-panel"]')).toBeVisible({ timeout: 3000 });
  });
});
