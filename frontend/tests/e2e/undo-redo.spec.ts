import { test, expect } from '@playwright/test';
import { dismissWelcome, expectRoadCount, openApp } from './helpers';

test('undo and redo work after adding a road from a template', async ({ page }) => {
  await openApp(page);
  await dismissWelcome(page);

  await expectRoadCount(page, 0);

  await page.getByRole('button', { name: '单车道' }).click();
  await expectRoadCount(page, 1);

  const undoButton = page.getByTitle('撤销 (Ctrl+Z)');
  const redoButton = page.getByTitle('重做 (Ctrl+Y)');

  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expectRoadCount(page, 0);

  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expectRoadCount(page, 1);
});
