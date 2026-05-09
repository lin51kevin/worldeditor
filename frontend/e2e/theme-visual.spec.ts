import { test, expect } from '@playwright/test';

test.describe('UI Theme Visual Tests — Scheme B Canvas', () => {
  test('dark theme — full layout screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'e2e/screenshots/dark-theme-full.png',
      fullPage: false,
    });
  });

  test('dark theme — statusbar chips (not full-width bar)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.statusbar');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const statusbar = page.locator('.statusbar');
    await expect(statusbar).toBeVisible();

    // Status items should be pill-shaped chips, not full-width bar
    const chips = page.locator('.statusbar-item');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThanOrEqual(2);

    await statusbar.screenshot({
      path: 'e2e/screenshots/dark-statusbar.png',
    });
  });

  test('dark theme — floating capsule toolbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.toolbar');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const toolbar = page.locator('.toolbar');
    await toolbar.screenshot({
      path: 'e2e/screenshots/dark-toolbar-capsule.png',
    });

    // Toolbar should be centered (has transform translateX(-50%))
    const box = await toolbar.boundingBox();
    if (box) {
      const viewportWidth = (await page.viewportSize())?.width ?? 1280;
      const center = box.x + box.width / 2;
      expect(Math.abs(center - viewportWidth / 2)).toBeLessThan(50);
    }
  });

  test('dark theme — menubar with project name center', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.menubar');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const menubar = page.locator('.menubar');
    await menubar.screenshot({
      path: 'e2e/screenshots/dark-menubar.png',
    });

    // Project name should be visible in center
    const projectName = page.locator('.menubar-project-name');
    await expect(projectName).toBeVisible();

    // Theme toggle icon should be on the right
    const themeBtn = page.locator('.menubar-icon-btn');
    await expect(themeBtn).toBeVisible();
  });

  test('dark theme — floating left panel with layers + templates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layer-panel');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const floatingLeft = page.locator('.floating-left');
    if (await floatingLeft.isVisible()) {
      await floatingLeft.screenshot({
        path: 'e2e/screenshots/dark-left-panel.png',
      });
    }
  });

  test('light theme — full layout screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-container');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'e2e/screenshots/light-theme-full.png',
      fullPage: false,
    });
  });

  test('light theme — floating capsule toolbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.toolbar');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    const toolbar = page.locator('.toolbar');
    await toolbar.screenshot({
      path: 'e2e/screenshots/light-toolbar-capsule.png',
    });
  });

  test('light theme — floating left panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layer-panel');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    const floatingLeft = page.locator('.floating-left');
    if (await floatingLeft.isVisible()) {
      await floatingLeft.screenshot({
        path: 'e2e/screenshots/light-left-panel.png',
      });
    }
  });

  test('light theme — statusbar chips', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.statusbar');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    await page.locator('.statusbar').screenshot({
      path: 'e2e/screenshots/light-statusbar.png',
    });
  });
});
