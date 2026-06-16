import { describe, it, expect } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import type { ApiError } from '@/lib/api-client'

function retryFn() {
  const queries = createQueryClient().getDefaultOptions().queries
  return queries?.retry as (failureCount: number, error: unknown) => boolean
}

function apiError(httpStatus: number): ApiError {
  return { code: 'X', message: 'x', httpStatus }
}

describe('query retry policy', () => {
  it('never retries auth/not-found errors', () => {
    const retry = retryFn()
    expect(retry(0, apiError(401))).toBe(false)
    expect(retry(0, apiError(403))).toBe(false)
    expect(retry(0, apiError(404))).toBe(false)
  })

  it('retries other errors up to twice', () => {
    const retry = retryFn()
    expect(retry(0, apiError(500))).toBe(true)
    expect(retry(1, apiError(500))).toBe(true)
    expect(retry(2, apiError(500))).toBe(false)
  })
})
