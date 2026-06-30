/**
 * Playwright config — canvas-only e2e（v0.2.0 PR4）
 *
 * 与默认 playwright.config.ts 区别：
 *   - 不启 admin（cross-platform；现有默认 config 是 mac-only lsof + admin 依赖）
 *   - 不启 webServer，假设 dev server 已在 127.0.0.1:3001 跑（npm run dev:web）
 *   - 仅跑 e2e/canvas/ 目录
 *   - 依赖 DEV_AUTH_BYPASS=1 + NEXT_PUBLIC_API_MOCKING=enabled（.env 已设）
 *
 * 用法：
 *   终端 1：npm run dev:web
 *   终端 2：npm run --workspace apps/web test:e2e:canvas
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 3001)
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e/canvas',
  fullyParallel: false, // 共享 mock localStorage，避免并发污染
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE,
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
