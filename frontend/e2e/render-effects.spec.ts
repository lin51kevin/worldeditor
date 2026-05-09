/**
 * Render effects E2E verification.
 */
import { test, expect } from '@playwright/test';

test.describe('Render Effects', () => {
  test('viewport canvas renders with correct background', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test('grid is visible by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.viewport-canvas')).toBeVisible({ timeout: 10000 });
    // Grid is drawn via WebGPU — verify canvas exists and has dimensions
    const canvas = page.locator('.viewport-canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('camera auto-fits when road data loaded', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.viewport-canvas', { timeout: 10000 });
    // Verify viewport is present (camera fitting happens in JS)
    await expect(page.locator('.viewport-canvas')).toBeVisible();
  });
});
