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
    // Project name is in absolutely-positioned center span; verify via textContent
    const projectNameText = await page.locator('.menubar-project-name').textContent();
    expect(projectNameText).toBeTruthy();

    // Theme toggle icon should be on the right (use last() since there are two icon buttons)
    const themeBtn = page.locator('.menubar-icon-btn').last();
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

test.describe('Layer panel type-tag badge alignment', () => {
  /**
   * Injects a road with one lane section + signal + object into the store,
   * expands the tree, then checks that each .type-tag badge is vertically
   * centred (within ±2 px) relative to the sibling text node that precedes it
   * in the same .layer-name flex row.
   */
  test('type-tag badges are vertically centred with label text in lane/signal/object rows', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('we-show-welcome-on-startup', 'false');
    });
    await page.goto('/');
    await page.waitForSelector('.layer-panel');

    // Inject a minimal project with one lane, one signal, one object
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__projectStore;
      if (!store) throw new Error('__projectStore not available');

      const road = {
        id: 'r1',
        name: 'Test Road',
        length: 100,
        junction_id: null,
        link: { predecessor: null, successor: null },
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
        elevation_profile: [],
        lane_sections: [{
          s: 0,
          left: [{ id: 1, lane_type: 'Driving', width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [], render_hidden: false }],
          center: [],
          right: [{ id: -1, lane_type: 'Sidewalk', width: [{ s_offset: 0, a: 1.5, b: 0, c: 0, d: 0 }], road_marks: [], render_hidden: false }],
          render_hidden: false,
        }],
        signals: [{
          id: 'sig1', name: 'Stop Sign', s: 10, t: 2, z_offset: 0,
          orientation: '+', signal_type: 'R1', signal_subtype: '10',
          value: null, is_dynamic: false, h_offset: 0, width: 0.4, height: 2.0,
        }],
        objects: [{
          id: 'obj1', name: 'Barrier', object_type: 'Guardrail',
          position: { x: 20, y: 1, z: 0 },
          orientation: 0, hdg: 0, width: 0.2, height: 0.8, length: 5,
          corners: [], validity: null, from_object_ref: false,
        }],
      };

      store.getState().setProject({
        name: 'Badge Alignment Test',
        header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
        roads: [road],
        junctions: [],
      });
    });

    // Expand the road row and all child groups
    await page.evaluate(() => {
      // Expose expand toggles by clicking via DOM
    });

    // Click road row to expand it
    const roadRow = page.locator('.road-list-entry').first();
    await roadRow.locator('.road-expand').first().click();
    await page.waitForTimeout(100);

    // Expand lane section
    const sectionRow = roadRow.locator('.layer-item-section').first();
    await sectionRow.locator('.road-expand').click();
    await page.waitForTimeout(100);

    // Expand signals group (second sub-group header)
    const subGroupHeaders = roadRow.locator('.road-sub-group .layer-item-section');
    for (let i = 0; i < await subGroupHeaders.count(); i++) {
      await subGroupHeaders.nth(i).locator('.road-expand').click();
    }
    await page.waitForTimeout(150);

    // Collect all .type-tag badges that are visible
    const badges = page.locator('.layer-name .type-tag');
    const badgeCount = await badges.count();
    expect(badgeCount).toBeGreaterThanOrEqual(3); // ≥1 lane + 1 signal + 1 object

    // For each badge, verify its vertical midpoint is within ±2 px of the
    // midpoint of its .layer-name container (which contains the label text).
    for (let i = 0; i < badgeCount; i++) {
      const badge = badges.nth(i);
      const container = badge.locator('xpath=ancestor::span[contains(@class,"layer-name")][1]');

      const badgeBox = await badge.boundingBox();
      const containerBox = await container.boundingBox();

      // Skip badges outside the visible viewport (e.g. scrolled out)
      if (!badgeBox || !containerBox) continue;

      const badgeMidY = badgeBox.y + badgeBox.height / 2;
      const containerMidY = containerBox.y + containerBox.height / 2;

      // Badge centre must be within ±2 px of the row's vertical midpoint
      expect(
        Math.abs(badgeMidY - containerMidY),
        `badge[${i}] midY=${badgeMidY.toFixed(1)} vs container midY=${containerMidY.toFixed(1)}`,
      ).toBeLessThanOrEqual(2);
    }
  });
});
