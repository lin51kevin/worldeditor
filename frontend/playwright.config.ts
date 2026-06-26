import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  // `E2E_FUNCTIONAL_ONLY=1` excludes the screenshot-based specs so the
  // functional suite can act as a deterministic, non-flaky CI gate that does
  // not depend on platform-specific pixel baselines.
  testIgnore: process.env.E2E_FUNCTIONAL_ONLY
    ? ['**/visual-regression.spec.ts', '**/theme-visual.spec.ts']
    : [],
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  snapshotDir: './e2e/__snapshots__',
  expect: {
    toHaveScreenshot: {
      // 10% pixel threshold to handle cross-platform GPU rendering differences.
      threshold: 0.1,
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      // CI: headless with SwiftShader software renderer.
      // Local: headed so the OS compositor exposes hardware WebGPU to Chromium.
      headless: !!process.env.CI,
      args: [
        '--enable-unsafe-webgpu',
        ...(process.env.CI
          ? ['--use-gl=angle', '--use-angle=swiftshader']
          : ['--disable-gpu-sandbox']),
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'yarn dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
