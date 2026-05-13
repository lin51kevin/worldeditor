import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { canParseXodr, expectRoadCount, getRoadCountFromStore, openApp } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const minimalXodrPath = path.resolve(__dirname, '../../../tests/fixtures/xodr/minimal.xodr');

test('can open an XODR file and sync the status bar road count', async ({ page }) => {
  await openApp(page);

  const xmlContent = await readFile(minimalXodrPath, 'utf8');
  const parserAvailable = await canParseXodr(page, xmlContent);
  test.skip(!parserAvailable, 'WASM-backed OpenDRIVE parsing is unavailable in this browser environment.');

  const welcomeDialog = page.getByRole('dialog', { name: 'WorldEditor Next' });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await welcomeDialog.getByRole('button', { name: '打开文件...' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(minimalXodrPath);

  await expect(welcomeDialog).toBeHidden();
  await expect(page.locator('.menubar-project-name')).toContainText('minimal.xodr');

  const roadCount = await getRoadCountFromStore(page);
  await expectRoadCount(page, roadCount);
});
