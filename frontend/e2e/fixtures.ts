import { test as base, type Page } from '@playwright/test';
import type { Project, Road } from '../src/services/platform';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extended Playwright test with WorldEditor-specific fixtures.
 */
export const test = base.extend<{
  editorPage: Page;
}>({
  editorPage: async ({ page }, use) => {
    await page.goto('/');
    // Wait for the app shell to render
    await page.waitForSelector('.toolbar');
    await use(page);
  },
});

export { expect } from '@playwright/test';

/** Inject a project into the Zustand store via the __editorStore bridge. */
export async function injectProject(page: Page, project: Project): Promise<void> {
  await page.evaluate((proj) => {
    const store = (window as Record<string, any>).__editorStore;
    if (!store) throw new Error('__editorStore not available — is DEV mode running?');
    store.getState().setProject(proj);
  }, project);
}

/** Get current project state from the Zustand store. */
export async function getProject(page: Page): Promise<Project> {
  return page.evaluate(() => {
    const store = (window as Record<string, any>).__editorStore;
    return store.getState().project;
  });
}

/** Get the isDirty flag from the store. */
export async function getIsDirty(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const store = (window as Record<string, any>).__editorStore;
    return store.getState().isDirty;
  });
}

/** Build a minimal Road object for testing. */
export function makeTestRoad(id: string, name = `Test Road ${id}`, length = 100): Road {
  return {
    id,
    name,
    length,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [],
  };
}

/** Build a minimal Project for testing. */
export function makeTestProject(name = 'Test Project', roads: Road[] = []): Project {
  return {
    name,
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads,
    junctions: [],
  };
}

/** Read an xodr fixture file from the repo's test fixtures directory. */
export function readXodrFixture(filename: string): string {
  const fixturePath = path.resolve(__dirname, '../../tests/fixtures/xodr', filename);
  return fs.readFileSync(fixturePath, 'utf-8');
}

/** Parse xodr XML in the browser via WASM and load it into the store. */
export async function openXodrInBrowser(page: Page, xml: string, filename = 'test.xodr'): Promise<void> {
  await page.evaluate(
    async ({ xmlContent, name }) => {
      const getSvc = (window as Record<string, any>).__getPlatformService;
      if (!getSvc) throw new Error('__getPlatformService not available');
      const svc = await getSvc();
      const project = await svc.parseOpenDrive(xmlContent);
      project.name = name;
      const store = (window as Record<string, any>).__editorStore;
      store.getState().setProject(project);
    },
    { xmlContent: xml, name: filename },
  );
}
