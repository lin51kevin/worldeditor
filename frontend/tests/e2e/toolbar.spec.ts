import { test, expect } from '@playwright/test';
import { dismissWelcome, openApp } from './helpers';

const toolbarModes = ['默认', '道路', '车道', '车道簇'] as const;

test('toolbar mode buttons can be activated', async ({ page }) => {
  await openApp(page);
  await dismissWelcome(page);

  const toolbar = page.locator('.toolbar');

  for (const modeLabel of toolbarModes) {
    const modeButton = toolbar.getByRole('button', { name: modeLabel, exact: true });
    await modeButton.click();
    await expect(modeButton).toHaveAttribute('aria-pressed', 'true');
  }
});
