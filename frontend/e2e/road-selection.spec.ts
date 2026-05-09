import { test, expect, injectProject, makeTestProject, makeTestRoad } from './fixtures';

test.describe('Road Selection & Properties', () => {
  test('click road in layer panel shows properties', async ({ editorPage: page }) => {
    await injectProject(page, makeTestProject('Test', [
      makeTestRoad('10', 'Highway A1', 1500),
      makeTestRoad('20', 'Local Road B2', 300),
    ]));

    // Click a road in the layer panel
    await page.locator('.layer-item').filter({ hasText: 'Highway A1' }).click();

    // Property panel shows road details
    await expect(page.locator('.property-panel').getByText('10')).toBeVisible();
    await expect(page.locator('.property-panel').locator('input.property-input').first()).toHaveValue('Highway A1');
    await expect(page.locator('.property-panel').getByText('1500.00 m')).toBeVisible();
  });

  test('click different road updates properties', async ({ editorPage: page }) => {
    await injectProject(page, makeTestProject('Test', [
      makeTestRoad('1', 'Road A', 100),
      makeTestRoad('2', 'Road B', 250),
    ]));

    // Select road A
    await page.locator('.layer-item').filter({ hasText: 'Road A' }).click();
    await expect(page.locator('.property-panel').getByText('100.00 m')).toBeVisible();

    // Switch to road B
    await page.locator('.layer-item').filter({ hasText: 'Road B' }).click();
    await expect(page.locator('.property-panel').getByText('250.00 m')).toBeVisible();
  });

  test('no selection shows empty state', async ({ editorPage: page }) => {
    await expect(page.getByText('未选择对象')).toBeVisible();
  });
});
