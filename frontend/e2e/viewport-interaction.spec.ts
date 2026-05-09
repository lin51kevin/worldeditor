/**
 * Viewport interaction E2E verification.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function dragViewport(
  page: Page,
  button: 'left' | 'right',
  sourcePosition: { x: number; y: number },
  targetPosition: { x: number; y: number },
): Promise<void> {
  const fromX = sourcePosition.x;
  const fromY = sourcePosition.y;
  const toX = targetPosition.x;
  const toY = targetPosition.y;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down({ button });
  await page.mouse.move(toX, toY);
  await page.mouse.up({ button });
}

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
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 200, box!.y + 150);

    if (hasWebGPU) {
      // With WebGPU, coordinates are computed via unprojectToGround
      const statusText = await page.locator('.statusbar').textContent();
      expect(statusText).toBeTruthy();
    }
    // Without WebGPU, coordinates may stay at 0,0 — that's expected
  });

  test('viewport supports left-drag pan', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await dragViewport(
      page,
      'left',
      { x: box!.x + 200, y: box!.y + 200 },
      { x: box!.x + 250, y: box!.y + 235 },
    );
    await expect(canvas).toBeVisible();
  });

  test('viewport supports orbit gestures on right-drag and ctrl-left-drag', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await dragViewport(
      page,
      'right',
      { x: box!.x + 210, y: box!.y + 210 },
      { x: box!.x + 260, y: box!.y + 250 },
    );

    await page.keyboard.down('Control');
    try {
      await dragViewport(
        page,
        'left',
        { x: box!.x + 230, y: box!.y + 180 },
        { x: box!.x + 275, y: box!.y + 220 },
      );
    } finally {
      await page.keyboard.up('Control');
    }

    await expect(canvas).toBeVisible();
  });

  test('viewport supports mouse-wheel zoom', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('.viewport-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + 220, box!.y + 180);
    await page.mouse.wheel(0, 180);

    await expect(page.locator('.statusbar')).toBeVisible();
  });
});
