/**
 * Template Panel E2E tests
 *
 * Verifies that every entry in the declarative catalog (defaultCatalog.ts) is
 * properly wired to the TemplatePanel UI:
 *
 *   - All 4 category tabs are visible (道路 / 交汇处 / 信号 / 喷漆)
 *   - Each tab shows the correct number of items matching the catalog
 *   - Every translated label appears in the panel
 *   - Clicking a road template enters spline draw mode
 *   - Clicking a junction template sets a pendingTemplateId (click-to-place)
 *   - Clicking a signal/marking template applies to the selected road
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setupPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('we-show-welcome-on-startup', 'false');
    // Remove persisted layout state so templatePanelCollapsed always starts false
    localStorage.removeItem('we-editor-view');
    // Remove persisted panel positions so panels don't overlap
    localStorage.removeItem('we-panel-template');
    localStorage.removeItem('we-panel-left');
    localStorage.removeItem('we-panel-right');
  });
  await page.goto('/');
  await page.waitForSelector('.toolbar', { timeout: 10000 });
  // Wait for DEV store bridges to be registered (they're async dynamic imports)
  await page.waitForFunction(() => !!(window as any).__projectStore, { timeout: 5000 });
  await page.waitForFunction(() => !!(window as any).__viewportStore, { timeout: 5000 });
}

async function getEditMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as any).__viewportStore;
    return store.getState().editMode as string;
  });
}

async function getPendingTemplateId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as any).__viewportStore;
    return store.getState().pendingTemplateId as string | null;
  });
}

async function getSplineTemplateId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as any).__viewportStore;
    return store.getState().splineTemplateId as string | null;
  });
}

/** Click the tab whose visible text matches the given label. */
async function clickTab(page: Page, label: string): Promise<void> {
  await page.locator('.template-tab', { hasText: label }).click();
}

/** Count visible .template-item elements in the current tab. */
async function countItems(page: Page): Promise<number> {
  return page.locator('.template-item').count();
}

/** Add a minimal road to the project and select it (needed for signal/marking tests). */
async function addAndSelectRoad(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as any).__projectStore;
    const road = {
      id: 'e2e-road-1',
      name: 'E2E Road',
      length: 100,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, geo_type: 'Line', length: 100 }],
      lane_sections: [{
        s: 0,
        left: [{
          id: 1, lane_type: 'Driving', level: 0, link: null,
          width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
          road_marks: [],
        }],
        center: [{ id: 0, lane_type: 'None', level: 0, link: null, width: [], road_marks: [] }],
        right: [{
          id: -1, lane_type: 'Driving', level: 0, link: null,
          width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
          road_marks: [],
        }],
      }],
      elevation_profile: [],
    };
    store.getState().addRoad(road);
    store.getState().selectRoad('e2e-road-1');
    return 'e2e-road-1';
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Template Panel — catalog wiring', () => {

  // ── Category tabs visible ─────────────────────────────────────────────────

  test('shows all 4 category tabs', async ({ page }) => {
    await setupPage(page);

    await expect(page.locator('.template-tab', { hasText: '道路' })).toBeVisible();
    await expect(page.locator('.template-tab', { hasText: '交汇处' })).toBeVisible();
    await expect(page.locator('.template-tab', { hasText: '信号' })).toBeVisible();
    await expect(page.locator('.template-tab', { hasText: '喷漆' })).toBeVisible();
  });

  test('shows favorites tab', async ({ page }) => {
    await setupPage(page);
    await expect(page.locator('.template-tab', { hasText: '收藏' })).toBeVisible();
  });

  // ── Road templates ─────────────────────────────────────────────────────────

  test.describe('Roads tab', () => {
    test('shows 7 road templates', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '道路');
      expect(await countItems(page)).toBe(7);
    });

    test('all 7 road labels match catalog', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '道路');

      const expected = [
        '单车道',
        '双向2车道',
        '双向4车道带路肩',
        '双向6车道带路肩',
        '高速公路',
        '匝道',
        '城市道路',
      ];
      for (const label of expected) {
        await expect(page.locator('.template-label', { hasText: label })).toBeVisible();
      }
    });

    test('clicking a road template enters spline draw mode', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '道路');
      await page.locator('.template-item', { hasText: '单车道' }).click();

      const mode = await getEditMode(page);
      expect(mode).toBe('spline');
    });

    test('clicking a road template sets splineTemplateId', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '道路');
      await page.locator('.template-item', { hasText: '双向4车道带路肩' }).click();

      const tplId = await getSplineTemplateId(page);
      expect(tplId).toBe('tpl:road:dual4');
    });

    test('road template item gets selected class after click', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '道路');
      const item = page.locator('.template-item', { hasText: '匝道' });
      await item.click();
      await expect(item).toHaveClass(/selected/);
    });
  });

  // ── Junction templates ─────────────────────────────────────────────────────

  test.describe('Junctions tab', () => {
    test('shows 5 junction templates', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '交汇处');
      expect(await countItems(page)).toBe(5);
    });

    test('all 5 junction labels match catalog', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '交汇处');

      const expected = [
        'T型路口',
        '十字路口',
        '五叉路口',
        '六叉路口',
        '环形路口',
      ];
      for (const label of expected) {
        await expect(page.locator('.template-label', { hasText: label })).toBeVisible();
      }
    });

    test('clicking a junction template enters pending-place mode', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '交汇处');
      await page.locator('.template-item', { hasText: 'T型路口' }).click();

      const pendingId = await getPendingTemplateId(page);
      expect(pendingId).toBe('tpl:jct:t');
    });

    test('clicking cross intersection sets correct pending id', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '交汇处');
      await page.locator('.template-item', { hasText: '十字路口' }).click();

      const pendingId = await getPendingTemplateId(page);
      expect(pendingId).toBe('tpl:jct:cross');
    });

    test('junction template item gets pending class after click', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '交汇处');
      const item = page.locator('.template-item', { hasText: '环形路口' });
      await item.click();
      await expect(item).toHaveClass(/pending/);
    });
  });

  // ── Signal templates ───────────────────────────────────────────────────────

  test.describe('Signals tab', () => {
    test('shows 8 signal templates', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '信号');
      expect(await countItems(page)).toBe(8);
    });

    test('all 8 signal labels match catalog', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '信号');

      const expected = [
        '交通灯',
        '停车标志',
        '警告标志',
        '限速30',
        '限速60',
        '限速80',
        '限速120',
        '禁止驶入',
      ];
      for (const label of expected) {
        await expect(page.locator('.template-label', { hasText: label })).toBeVisible();
      }
    });

    test('clicking signal template with a selected road adds signal to road', async ({ page }) => {
      await setupPage(page);
      await addAndSelectRoad(page);
      // Ensure template panel tabs are visible (right inspector opening may take a render cycle)
      await expect(page.locator('.template-tab', { hasText: '信号' })).toBeVisible({ timeout: 5000 });
      await clickTab(page, '信号');

      const before = await page.evaluate(() => {
        const store = (window as any).__projectStore;
        return (store.getState().project.signals ?? []).length as number;
      });

      await page.locator('.template-item', { hasText: '交通灯' }).click();

      const after = await page.evaluate(() => {
        const store = (window as any).__projectStore;
        return (store.getState().project.signals ?? []).length as number;
      });

      // Signal count should increase (signal added to project.signals)
      expect(after).toBeGreaterThan(before);
    });
  });

  // ── Marking templates ──────────────────────────────────────────────────────

  test.describe('Markings tab', () => {
    test('shows 6 marking templates', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '喷漆');
      expect(await countItems(page)).toBe(6);
    });

    test('all 6 marking labels match catalog', async ({ page }) => {
      await setupPage(page);
      await clickTab(page, '喷漆');

      const expected = [
        '实白线',
        '虚白线',
        '实黄线',
        '双黄线',
        '斑马线',
        '无标线',
      ];
      for (const label of expected) {
        await expect(page.locator('.template-label', { hasText: label })).toBeVisible();
      }
    });

    test('clicking marking template applies mark to selected road lanes', async ({ page }) => {
      await setupPage(page);
      await addAndSelectRoad(page);
      // Ensure template panel tabs are visible before clicking
      await expect(page.locator('.template-tab', { hasText: '喷漆' })).toBeVisible({ timeout: 5000 });
      await clickTab(page, '喷漆');

      await page.locator('.template-item', { hasText: '实黄线' }).click();

      const roadMarks = await page.evaluate(() => {
        const store = (window as any).__projectStore;
        const roads = store.getState().project.roads as any[];
        const road = roads.find((r: any) => r.id === 'e2e-road-1');
        const sec = road?.lane_sections?.[0];
        return sec?.left?.[0]?.road_marks ?? [];
      });

      expect(roadMarks.length).toBeGreaterThan(0);
      expect(roadMarks[0].mark_type).toBe('Solid');
      expect(roadMarks[0].color).toBe('Yellow');
    });
  });

  // ── Total catalog count ────────────────────────────────────────────────────

  test('total item count across all tabs matches catalog (26 unique templates)', async ({ page }) => {
    await setupPage(page);

    const tabs = ['道路', '交汇处', '信号', '喷漆'];
    let total = 0;
    for (const tab of tabs) {
      await clickTab(page, tab);
      total += await countItems(page);
    }
    // 7 roads + 5 junctions + 8 signals + 6 markings = 26
    expect(total).toBe(26);
  });

  // ── Favorites ─────────────────────────────────────────────────────────────

  test('starring a template adds it to favorites tab', async ({ page }) => {
    await setupPage(page);
    await clickTab(page, '道路');

    // Star the first road template
    const favBtn = page.locator('.template-item', { hasText: '单车道' }).locator('.template-fav-btn');
    await favBtn.click();

    // Switch to favorites tab
    await page.locator('.template-tab', { hasText: '收藏' }).click();

    await expect(page.locator('.template-label', { hasText: '单车道' })).toBeVisible();
  });

  test('un-starring removes item from favorites tab', async ({ page }) => {
    await setupPage(page);
    await clickTab(page, '道路');

    const favBtn = page.locator('.template-item', { hasText: '单车道' }).locator('.template-fav-btn');
    await favBtn.click(); // star
    await favBtn.click(); // un-star

    await page.locator('.template-tab', { hasText: '收藏' }).click();
    await expect(page.locator('.template-empty')).toBeVisible();
  });

  // ── drag ──────────────────────────────────────────────────────────────────

  test('road template item is draggable', async ({ page }) => {
    await setupPage(page);
    await clickTab(page, '道路');

    const item = page.locator('.template-item', { hasText: '单车道' });
    await expect(item).toHaveAttribute('draggable', 'true');
  });
});
