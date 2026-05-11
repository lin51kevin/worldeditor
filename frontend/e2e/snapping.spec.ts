/**
 * Snapping E2E tests.
 * Covers: snap toggle, snap mode switching, snap state persistence.
 */
import { test, expect } from './fixtures';

test.describe('Snapping', () => {
  test('snap toggle button in toolbar', async ({ editorPage: page }) => {
    // Snap button is in MenuBar quick-actions (icon-only, identified by title)
    const snapBtn = page.locator('.menubar-action-btn[title*="吸附"]');
    await expect(snapBtn).toBeVisible({ timeout: 5000 });

    // Initially not active
    await expect(snapBtn).not.toHaveClass(/active/);

    // Click to enable
    await snapBtn.click();
    await expect(snapBtn).toHaveClass(/active/);

    // Click to disable
    await snapBtn.click();
    await expect(snapBtn).not.toHaveClass(/active/);
  });

  test('snap state changes via store bridge', async ({ editorPage: page }) => {
    // Toggle snap via store
    const snapEnabled = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      if (!viewStore) return null;
      viewStore.getState().toggleSnap();
      return viewStore.getState().snapEnabled;
    });
    expect(snapEnabled).toBe(true);

    // Change snap mode
    const snapMode = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setSnapMode('Endpoint');
      return viewStore.getState().snapMode;
    });
    expect(snapMode).toBe('Endpoint');

    // Change threshold
    const threshold = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      viewStore.getState().setSnapThreshold(10);
      return viewStore.getState().snapThreshold;
    });
    expect(threshold).toBe(10);
  });

  test('snap toggle via command palette', async ({ editorPage: page }) => {
    // Open command palette
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cp-container')).toBeVisible({ timeout: 3000 });

    // Type snap
    await page.locator('.cp-input').fill('吸附');
    await page.keyboard.press('Enter');

    // Verify snap is now enabled
    const snapEnabled = await page.evaluate(() => {
      const viewStore = (window as Record<string, any>).__editorViewStore;
      return viewStore?.getState().snapEnabled;
    });
    expect(snapEnabled).toBe(true);
  });

  test('snap menu entry in Tools menu', async ({ editorPage: page }) => {
    // Open the hamburger mega-menu
    await page.locator('.menubar-hamburger').click();
    await expect(page.locator('.menubar-mega-dropdown')).toBeVisible({ timeout: 3000 });

    // Hover over the '工具' mega-item to reveal its submenu
    const toolsItem = page.locator('.menubar-mega-item', { hasText: '工具' });
    await toolsItem.hover();
    await expect(page.locator('.menubar-submenu')).toBeVisible({ timeout: 3000 });

    // Find the snap entry in the submenu
    const snapEntry = page.locator('.menubar-submenu .menubar-dropdown-item', { hasText: '吸附' });
    await expect(snapEntry).toBeVisible();
  });
});
