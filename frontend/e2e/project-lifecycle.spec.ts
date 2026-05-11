import { test, expect, injectProject, makeTestProject, makeTestRoad } from './fixtures';

test.describe('Project Lifecycle', () => {
  test('load project and see roads in layer panel', async ({ editorPage: page }) => {
    const project = makeTestProject('Beijing Demo', [
      makeTestRoad('1', 'Main Street', 200),
      makeTestRoad('2', 'Side Road', 80),
    ]);

    await injectProject(page, project);

    // Project name updates in toolbar
    // Project name in toolbar (absolute-positioned span — check via textContent)
    const projectName = await page.locator('.toolbar-title').textContent();
    expect(projectName).toContain('Beijing Demo');

    // Roads show in layer panel (format: 场景 (道路: 2, 路口: 0))
    await expect(page.locator('.layer-section-toggle').last()).toContainText('道路: 2');
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
    await expect(page.locator('.layer-section-toggle').last()).toContainText('道路: 1');

    // Click 新建 via keyboard shortcut (no text-labeled button in current UI)
    await page.keyboard.press('Control+n');

    // Reverts to initial state
    const resetName = await page.locator('.toolbar-title').textContent();
    expect(resetName).toContain('Untitled');
    await expect(page.locator('.layer-section-toggle').last()).toContainText('道路: 0');
    await expect(page.locator('.statusbar')).toContainText('道路: 0');
  });
});
