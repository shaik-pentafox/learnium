import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      // The 80% gate applies to integration-critical logic, not UI/routes.
      include: ['src/services/**', 'src/features/**', 'src/lib/**'],
      thresholds: { statements: 80, branches: 80, lines: 80 },
    },
  },
})
