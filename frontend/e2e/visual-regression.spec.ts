/**
 * Visual regression tests — screenshot comparison against stored baselines.
 *
 * Run once to generate baselines:
 *   yarn playwright test visual-regression --update-snapshots
 *
 * Then on subsequent runs, any pixel deviation beyond the configured threshold
 * (10% threshold, 2% max differing pixels) causes the test to fail.
 *
 * CI note: playwright.config.ts enables SwiftShader software rendering so
 * these tests work in headless CI environments without a real GPU.
 */

import { test, expect, injectProject, openXodrInBrowser, readXodrFixture, makeTestProject, makeTestRoad } from './fixtures';

// Wait for the WebGPU canvas to emit at least two animation frames so the
// rendered scene is stable before taking a screenshot.
async function waitForRender(page: import('@playwright/test').Page, ms = 400): Promise<void> {
  await page.evaluate(
    (delay) =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          if (++frames >= 2) {
            setTimeout(resolve, delay);
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

// Capture just the viewport canvas element.
async function canvasScreenshot(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const canvas = page.locator('canvas.viewport-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveScreenshot(name);
}

// ── Scenes ─────────────────────────────────────────────────────────────────

test.describe('Visual regression — rendering', () => {
  test('empty project renders grid only', async ({ editorPage: page }) => {
    await waitForRender(page);
    await canvasScreenshot(page, 'empty-project.png');
  });

  test('single straight road renders correctly', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');
    await waitForRender(page);
    // Zoom to fit so the road fills the viewport regardless of initial camera.
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, 'single-road.png');
  });

  test('junction renders correctly', async ({ editorPage: page }) => {
    const xml = readXodrFixture('junction.xodr');
    await openXodrInBrowser(page, xml, 'junction.xodr');
    await waitForRender(page);
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, 'junction.png');
  });

  test('selected road renders highlight', async ({ editorPage: page }) => {
    const road = makeTestRoad('r1', 'Selected Road', 100);
    road.plan_view = [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' as const }];
    const project = makeTestProject('Highlight Test', [road]);
    await injectProject(page, project);
    await waitForRender(page);
    // Select the road via the store.
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__editorStore;
      store.getState().selectRoad('r1');
    });
    await waitForRender(page);
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, 'road-selected-highlight.png');
  });

  test('multi-lane road (dual_four_lane template) renders correctly', async ({ editorPage: page }) => {
    const xml = readXodrFixture('multi_lane.xodr');
    await openXodrInBrowser(page, xml, 'multi_lane.xodr');
    await waitForRender(page);
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, 'multi-lane.png');
  });

  test('arc road renders curved geometry', async ({ editorPage: page }) => {
    const xml = readXodrFixture('arc_road.xodr');
    await openXodrInBrowser(page, xml, 'arc_road.xodr');
    await waitForRender(page);
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, 'arc-road.png');
  });

  test('2D mode renders orthographic view', async ({ editorPage: page }) => {
    const xml = readXodrFixture('single_road.xodr');
    await openXodrInBrowser(page, xml, 'single_road.xodr');
    await waitForRender(page);
    // Switch to 2D mode.
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('set-dimension', '2d');
    });
    await waitForRender(page);
    await page.evaluate(() => {
      const events = (window as Record<string, any>).__viewportEvents;
      if (events) events.emit('zoom-to-fit');
    });
    await waitForRender(page);
    await canvasScreenshot(page, '2d-mode.png');
  });
});
