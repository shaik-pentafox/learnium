import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

/** MSW worker lives in public/ for vite dev — strip from production dist. */
function stripDevPublicAssets(): Plugin {
  return {
    name: 'strip-dev-public-assets',
    closeBundle() {
      const mswWorker = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        'dist/mockServiceWorker.js',
      )
      if (fs.existsSync(mswWorker)) fs.unlinkSync(mswWorker)
    },
  }
}

// https://vite.dev/config/
// No dev proxy: the app calls the backend directly via VITE_API_URL (CORS).
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    stripDevPublicAssets(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Pre-bundle deps that are only reached through lazily-imported routes
  // (e.g. react-colorful via the persona builder). Without this, Vite first
  // discovers them mid-session and forces a re-optimize + 504 on the in-flight
  // dynamic import.
  optimizeDeps: {
    include: ['react-colorful'],
  },
  server: {
    port: 5173,
  },
})
