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

// Sync the persisted theme to <html> before first paint (covers `system`,
// which the inline pre-hydration script in index.html can't fully resolve).
useUiStore.getState().setTheme(useUiStore.getState().theme)

/** Start MSW in dev unless explicitly disabled. Not bundled in production. */
async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV) return
  if (import.meta.env.VITE_ENABLE_MOCKS === 'false') return
  const { startMockWorker } = await import('./mocks/browser')
  await startMockWorker()
}

enableMocking()
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
