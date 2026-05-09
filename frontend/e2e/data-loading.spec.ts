/**
 * Data loading E2E verification.
 */
import { test, expect } from '@playwright/test';

test.describe('Data Loading', () => {
  test('app loads without error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    // Allow time for async init
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  test('status bar shows initial state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.statusbar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.statusbar')).toContainText('道路: 0');
  });
});
