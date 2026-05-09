import {
  test,
  expect,
  injectProject,
  makeTestProject,
  makeTestRoad,
  openXodrInBrowser,
  readXodrFixture,
} from './fixtures';

async function countRedHighlightPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.viewport-canvas') as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return 0;
    }

    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) {
      return 0;
    }
    ctx.drawImage(canvas, 0, 0);

    const sampleW = Math.min(canvas.width, 320);
    const sampleH = Math.min(canvas.height, 240);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

    let redLike = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 145 && r > g * 1.25 && r > b * 1.25) {
        redLike++;
      }
    }
    return redLike;
  });
}

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
    await expect(page.locator('.floating-right')).toHaveCount(0);
  });

  test('selecting a road adds visible red highlight in viewport', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');
    await page.waitForTimeout(800);

    const overlay = page.locator('.viewport-overlay');
    const hasWebGPU = !(await overlay.isVisible());
    test.skip(!hasWebGPU, 'WebGPU unavailable in current runtime; cannot sample highlight pixels.');

    const canvas = page.locator('canvas.viewport-canvas');
    await expect(canvas).toBeVisible();

    const beforeRed = await countRedHighlightPixels(page);

    await page.locator('.layer-item').filter({ hasText: 'MainStreet' }).click();
    await page.waitForTimeout(500);

    const afterRed = await countRedHighlightPixels(page);
    expect(afterRed).toBeGreaterThan(beforeRed + 30);
  });
});
