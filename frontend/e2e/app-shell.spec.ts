import { test, expect } from './fixtures';

test.describe('Application Shell', () => {
  test('renders all panels and toolbar', async ({ editorPage: page }) => {
    // MenuBar
    await expect(page.getByText('世界编辑器')).toBeVisible();

    // Toolbar buttons
    await expect(page.getByText('新建')).toBeVisible();
    await expect(page.getByText('打开...')).toBeVisible();
    await expect(page.getByText('保存...')).toBeVisible();
    await expect(page.getByText('撤销')).toBeVisible();
    await expect(page.getByText('重做')).toBeVisible();

    // Panels
    await expect(page.getByText('图层')).toBeVisible();
    await expect(page.getByText('属性')).toBeVisible();
    await expect(page.getByText('模板')).toBeVisible();
    await expect(page.getByText('语义')).toBeVisible();

    // Status bar
    await expect(page.locator('.statusbar')).toContainText('道路: 0');
    await expect(page.getByText('已保存')).toBeVisible();
  });

  test('displays project name in toolbar', async ({ editorPage: page }) => {
    await expect(page.getByText('Untitled')).toBeVisible();
  });
});
