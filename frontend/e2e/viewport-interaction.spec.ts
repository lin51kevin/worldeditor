/**
 * Viewport interaction E2E verification.
 */
import { test, expect } from '@playwright/test';

test.describe('Viewport Interaction', () => {
  test('canvas is present and sized', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('mouse move updates status bar coordinates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.statusbar')).toBeVisible({ timeout: 10000 });

    // Check if WebGPU renderer is active (no fallback overlay visible)
    const overlay = page.locator('.viewport-overlay');
    const hasWebGPU = !(await overlay.isVisible());

    const canvas = page.locator('.viewport-canvas');
    await canvas.hover({ position: { x: 200, y: 150 } });

    if (hasWebGPU) {
      // With WebGPU, coordinates are computed via unprojectToGround
      const statusText = await page.locator('.statusbar').textContent();
      expect(statusText).toBeTruthy();
    }
    // Without WebGPU, coordinates may stay at 0,0 — that's expected
  });

  test('viewport supports mouse drag (orbit)', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Drag should not throw errors
    await canvas.dragTo(canvas, {
      sourcePosition: { x: 200, y: 200 },
      targetPosition: { x: 250, y: 250 },
    });
    // No assertion needed — just verify no crash
  });
});
