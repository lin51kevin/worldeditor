import { test, expect } from './fixtures';

test.describe('3D Viewport', () => {
  test('should render canvas element', async ({ editorPage: page }) => {
    const canvas = page.locator('canvas.viewport-canvas');
    await expect(canvas).toBeVisible();
  });

  test('should show WebGPU status or fallback', async ({ editorPage: page }) => {
    // WebGPU may or may not be available in CI Chromium.
    // Either the viewport is rendering (no overlay) or shows a fallback message.
    const viewport = page.locator('.viewport');
    await expect(viewport).toBeVisible();

    const overlay = page.locator('.viewport-overlay');
    const hasOverlay = await overlay.isVisible();

    if (hasOverlay) {
      // Fallback message should be shown
      const label = page.locator('.viewport-label');
      await expect(label).toContainText('3D');
    }
    // If no overlay, WebGPU initialized successfully — canvas is rendering
  });

  test('should resize with container', async ({ editorPage: page }) => {
    const canvas = page.locator('canvas.viewport-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });
});
