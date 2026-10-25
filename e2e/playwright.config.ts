import { defineConfig } from '@playwright/test';

export const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8851);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5251);

export default defineConfig({
  testDir: './specs',
  outputDir: './.tmp/test-results',
  // One shared stack with shared state: journeys run serially, in file order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: './lib/global-setup.ts',
  globalTeardown: './lib/global-teardown.ts',
  reporter: [['list'], ['./lib/report-reporter.ts']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    trace: 'off',
  },
});
