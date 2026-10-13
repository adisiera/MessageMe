const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3101',
    browserName: 'chromium',
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3101/api/health',
    reuseExistingServer: false,
    env: {
      PORT: '3101',
      DATABASE_PATH: ':memory:',
      APP_ORIGINS: 'http://localhost:3101',
    },
    timeout: 30_000,
  },
});
