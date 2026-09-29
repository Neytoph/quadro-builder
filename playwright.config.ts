import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/engine',
  outputDir: '.work/playwright-results',
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
