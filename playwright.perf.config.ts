import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Performance check for large reports (`npm run test:perf`). Uses the same
 * build, reset and first-time setup as the E2E suite, then runs tests/perf.
 * PERF_IMAGES sets the number of screenshots (default 300).
 */
export default defineConfig({
  ...base,
  testDir: 'tests',
  projects: [
    { ...base.projects![0]!, testMatch: /e2e[\\/]setup\.spec\.ts/ },
    { ...base.projects![1]!, testMatch: /perf[\\/].*\.spec\.ts/, testIgnore: undefined },
  ],
})
