import { defineConfig } from 'vitest/config'
import { publicResources } from './scripts/publicResources'

export default defineConfig({
  plugins: [publicResources(process.cwd())],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
