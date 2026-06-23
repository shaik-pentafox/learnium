import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@/styles/globals.css'

import { routeTree } from './routeTree.gen'
import { queryClient } from '@/lib/query-client'
import { useUiStore } from '@/stores/ui'
import { restoreSession } from '@/services/auth'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

/** Start MSW in dev unless explicitly disabled (VITE_ENABLE_MOCKS=false hits
 *  the live backend through the vite proxy). No-op / not bundled in prod. */
async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV) return
  if (import.meta.env.VITE_ENABLE_MOCKS === 'false') return
  const { startMockWorker } = await import('./mocks/browser')
  await startMockWorker()
}

// Sync the persisted theme to <html> before first paint (covers `system`,
// which the inline pre-hydration script in index.html can't fully resolve).
useUiStore.getState().setTheme(useUiStore.getState().theme)

enableMocking()
  // Exchange a persisted refresh token for a fresh access token so a reload
  // keeps the session. Must finish before first render so route guards see it.
  .then(restoreSession)
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
