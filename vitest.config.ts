import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
}

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/db/global-setup.ts'],
          // DB tests share one local database; run files one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
