import { defineConfig, devices } from '@playwright/test'
import { ADMIN_STATE } from './tests/e2e/support'

const port = 4173
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // First-time setup through the UI; saves the administrator's session.
    { name: 'setup', testMatch: /setup.spec.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /setup.spec.ts/,
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
    },
  ],
  // E2E runs against a production build served by `vite preview`, so it
  // exercises the same bundle that gets deployed.
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
