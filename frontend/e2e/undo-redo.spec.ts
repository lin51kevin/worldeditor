import { test, expect, injectProject, getProject, makeTestProject, makeTestRoad } from './fixtures';

test.describe('Undo / Redo', () => {
  test('undo and redo buttons are disabled initially', async ({ editorPage: page }) => {
    // Undo/Redo are MenuBar quick-action buttons (menubar-action-btn)
    await expect(page.locator('.menubar-action-btn[title*="撤销"]')).toBeDisabled();
    await expect(page.locator('.menubar-action-btn[title*="重做"]')).toBeDisabled();
  });

  test('undo reverts addRoad, redo restores it', async ({ editorPage: page }) => {
    // Add a road via store injection (simulates a user action that pushes undo)
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__projectStore;
      store.getState().addRoad({
        id: '1',
        name: 'Undo Test Road',
        length: 100,
        junction_id: null,
        link: { predecessor: null, successor: null },
        plan_view: [],
        elevation_profile: [],
        lane_sections: [],
      });
    });

    // Road appears
    await expect(page.getByText('Undo Test Road')).toBeVisible();
    await expect(page.locator('.menubar-action-btn[title*="撤销"]')).toBeEnabled();

    // Click Undo
    await page.locator('.menubar-action-btn[title*="撤销"]').click();
    await expect(page.getByText('Undo Test Road')).not.toBeVisible();
    // Road count in statusbar reflects undo
    await expect(page.locator('.statusbar')).toContainText('道路: 0');

    // Click Redo
    await expect(page.locator('.menubar-action-btn[title*="重做"]')).toBeEnabled();
    await page.locator('.menubar-action-btn[title*="重做"]').click();
    await expect(page.getByText('Undo Test Road')).toBeVisible();
    await expect(page.locator('.statusbar')).toContainText('道路: 1');
  });

  test('Ctrl+Z / Ctrl+Y keyboard shortcuts', async ({ editorPage: page }) => {
    // Add a road
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__projectStore;
      store.getState().addRoad({
        id: '99',
        name: 'Shortcut Road',
        length: 50,
        junction_id: null,
        link: { predecessor: null, successor: null },
        plan_view: [],
        elevation_profile: [],
        lane_sections: [],
      });
    });

    await expect(page.getByText('Shortcut Road')).toBeVisible();

    // Ctrl+Z to undo
    await page.keyboard.press('Control+z');
    await expect(page.getByText('Shortcut Road')).not.toBeVisible();

    // Ctrl+Y to redo
    await page.keyboard.press('Control+y');
    await expect(page.getByText('Shortcut Road')).toBeVisible();
  });

  test('dirty indicator shows after mutation', async ({ editorPage: page }) => {
    // Initially saved
    await expect(page.getByText('已保存')).toBeVisible();

    // Add a road (mutation)
    await page.evaluate(() => {
      const store = (window as Record<string, any>).__projectStore;
      store.getState().addRoad({
        id: '1',
        name: 'Dirty Road',
        length: 10,
        junction_id: null,
        link: { predecessor: null, successor: null },
        plan_view: [],
        elevation_profile: [],
        lane_sections: [],
      });
    });

    // Status shows Modified, title shows dot
    await expect(page.getByText('已修改')).toBeVisible();
      // Toolbar-title span is absolutely positioned; check its text content directly
      const titleText = await page.locator('.toolbar-title').textContent();
      expect(titleText).toContain('•');
  });
});
