import { defineConfig, devices } from '@playwright/test'

const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT || 5175)
const ADMIN_BASE = process.env.E2E_ADMIN_BASE_URL || `http://127.0.0.1:${ADMIN_PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'admin-guard.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: ADMIN_BASE,
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'node scripts/start-admin-guard-smoke.mjs',
        url: `${ADMIN_BASE}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
