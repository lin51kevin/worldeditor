import { test, expect } from '@playwright/test';
import { dismissWelcome, openApp } from './helpers';

test('app launches, shows the welcome page, and dismisses it', async ({ page }) => {
  await openApp(page);

  const welcomeDialog = page.getByRole('dialog', { name: 'WorldEditor Next' });
  await expect(welcomeDialog).toBeVisible();
  await expect(welcomeDialog.getByText('自动驾驶道路网络编辑器')).toBeVisible();

  await dismissWelcome(page);

  await expect(page.locator('.menubar')).toBeVisible();
  await expect(page.locator('.toolbar')).toBeVisible();
});
