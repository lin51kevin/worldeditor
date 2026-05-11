import { test, expect } from './fixtures';

test.describe('Application Shell', () => {
  test('renders all panels and toolbar', async ({ editorPage: page }) => {
    // Page title (brand)
    await expect(page).toHaveTitle('世界编辑器');

    // MenuBar quick action buttons (icon-only, checked by title attribute)
    await expect(page.locator('.menubar-action-btn[title*="新建"]')).toBeVisible();
    await expect(page.locator('.menubar-action-btn[title*="打开"]')).toBeVisible();
    await expect(page.locator('.menubar-action-btn[title*="保存"]')).toBeVisible();
    await expect(page.locator('.menubar-action-btn[title*="撤销"]')).toBeVisible();
    await expect(page.locator('.menubar-action-btn[title*="重做"]')).toBeVisible();

    // Panels
    // Panels (LayerPanel = 导航器, TemplatePanel = 模板)
    await expect(page.getByText('导航器')).toBeVisible();
    await expect(page.getByText('模板')).toBeVisible();

    // Status bar
    await expect(page.locator('.statusbar')).toContainText('道路: 0');
    await expect(page.getByText('已保存')).toBeVisible();
  });

  test('displays project name in toolbar', async ({ editorPage: page }) => {
    const name = await page.locator('.toolbar-title').textContent();
    expect(name).toContain('Untitled');
  });
});
