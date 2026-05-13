import { expect, type Page } from '@playwright/test';

type EditorStoreBridge = {
  getState(): {
    project: {
      roads: unknown[];
    };
  };
};

type PlatformServiceBridge = {
  parseOpenDrive: (xml: string) => Promise<{ roads?: unknown[] }>;
};

type TestWindow = Window & {
  __editorStore?: EditorStoreBridge;
  __getPlatformService?: () => Promise<PlatformServiceBridge>;
};

export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('i18nextLng', 'zh');
  });

  await page.goto('/');
  await page.waitForSelector('.toolbar');
  await page.waitForSelector('.statusbar');
  await expect(page).toHaveURL(/127\.0\.0\.1:5173\/?$/);
  await page.waitForFunction(() => {
    const bridge = window as TestWindow;
    return Boolean(bridge.__editorStore && bridge.__getPlatformService);
  });
}

export async function dismissWelcome(page: Page): Promise<void> {
  const welcomeDialog = page.getByRole('dialog', { name: 'WorldEditor Next' });
  await expect(welcomeDialog).toBeVisible();
  await welcomeDialog.getByRole('button', { name: '关闭' }).click();
  await expect(welcomeDialog).toBeHidden();
}

export async function expectRoadCount(page: Page, count: number): Promise<void> {
  await expect(page.locator('.statusbar')).toContainText(`道路: ${count}`);
}

export async function getRoadCountFromStore(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bridge = window as TestWindow;
    return bridge.__editorStore?.getState().project.roads.length ?? -1;
  });
}

export async function canParseXodr(page: Page, xmlContent: string): Promise<boolean> {
  return page.evaluate(async (content) => {
    const bridge = window as TestWindow;
    if (!bridge.__getPlatformService) {
      return false;
    }

    try {
      const service = await bridge.__getPlatformService();
      const project = await service.parseOpenDrive(content);
      return Array.isArray(project?.roads);
    } catch {
      return false;
    }
  }, xmlContent);
}
