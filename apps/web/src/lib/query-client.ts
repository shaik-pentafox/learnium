import { QueryClient } from '@tanstack/react-query'
import type { ApiError } from '@/lib/api-client'
import { notify } from '@/lib/toast'

const FIVE_MINUTES = 5 * 60 * 1000
const TEN_MINUTES = 10 * 60 * 1000

/**
 * Single QueryClient. Server data lives here only (Zustand never caches API
 * responses). Mutations surface failures through react-hot-toast; the query
 * cache's global handler is the read-side backstop.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: FIVE_MINUTES,
        gcTime: TEN_MINUTES,
        retry: (failureCount, error) => {
          const status = (error as ApiError)?.httpStatus
          if (status === 401 || status === 403 || status === 404) return false
          return failureCount < 2
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        onError: (error) => notify.error(error),
      },
    },
  })
}
