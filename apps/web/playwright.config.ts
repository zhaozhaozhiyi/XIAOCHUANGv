import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 3001)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT || 5175)
const ADMIN_BASE = `http://127.0.0.1:${ADMIN_PORT}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: Number(process.env.E2E_TEST_TIMEOUT_MS || 120_000),
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE,
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `if ! lsof -nP -iTCP:${ADMIN_PORT} -sTCP:LISTEN >/dev/null 2>&1; then (cd ../admin && npx next dev --port ${ADMIN_PORT} -H 127.0.0.1 > /private/tmp/admin.log 2>&1 &) ; fi && node -e "const url='${ADMIN_BASE}/login'; const start=Date.now(); (async()=>{while(Date.now()-start<180000){try{const r=await fetch(url,{method:'GET'}); if(r.ok) process.exit(0);}catch(e){} await new Promise(res=>setTimeout(res,1000));} console.error('admin not ready'); process.exit(1);})()" && E2E_AUTH_MOCK=1 ADMIN_BASE_URL=${ADMIN_BASE} NEXT_DIST_DIR=.next-e2e node scripts/run-next.mjs .next-e2e dev -p ${PORT} -H 127.0.0.1`,
        url: `${BASE}/login`,
        reuseExistingServer: false,
        timeout: Number(process.env.E2E_WEBSERVER_TIMEOUT_MS || 300_000),
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
