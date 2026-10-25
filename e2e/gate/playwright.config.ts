// pnpm gate  ->  playwright with this config. The e2e helpers read E2E_* ports at import time, so they are pinned to
// the gate's own ports BEFORE anything imports them.
process.env.E2E_HUB_PORT = process.env.GATE_HUB_PORT ?? '8927';
process.env.E2E_WEB_PORT = process.env.GATE_WEB_PORT ?? '5327';
process.env.E2E_AGENT_BASE = process.env.GATE_AGENT_BASE ?? '4771';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /(gate|variants)\.spec\.ts$/,
  outputDir: './.tmp/test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 10_000 },
  globalSetup: './lib/global-setup.ts',
  globalTeardown: './lib/global-teardown.ts',
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.E2E_WEB_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    trace: 'off',
  },
});
