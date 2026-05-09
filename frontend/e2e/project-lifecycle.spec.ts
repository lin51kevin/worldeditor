import { test, expect, injectProject, makeTestProject, makeTestRoad } from './fixtures';

test.describe('Project Lifecycle', () => {
  test('load project and see roads in layer panel', async ({ editorPage: page }) => {
    const project = makeTestProject('Beijing Demo', [
      makeTestRoad('1', 'Main Street', 200),
      makeTestRoad('2', 'Side Road', 80),
    ]);

    await injectProject(page, project);

    // Project name updates in toolbar
    await expect(page.getByText('Beijing Demo')).toBeVisible();

    // Roads show in layer panel
    await expect(page.getByText('道路列表 (2)')).toBeVisible();
    await expect(page.getByText('Main Street')).toBeVisible();
    await expect(page.getByText('Side Road')).toBeVisible();

    // Status bar reflects count
    await expect(page.locator('.statusbar')).toContainText('道路: 2');

    // Saved state (setProject clears dirty)
    await expect(page.getByText('已保存')).toBeVisible();
  });

  test('reset project clears everything', async ({ editorPage: page }) => {
    // Load a project first
    await injectProject(page, makeTestProject('MyProject', [makeTestRoad('1')]));
    await expect(page.getByText('道路列表 (1)')).toBeVisible();

    // Click 新建
    await page.locator('.toolbar-btn').filter({ hasText: '新建' }).click();

    // Reverts to initial state
    await expect(page.getByText('Untitled')).toBeVisible();
    await expect(page.getByText('道路列表 (0)')).toBeVisible();
    await expect(page.locator('.statusbar')).toContainText('道路: 0');
  });
});
