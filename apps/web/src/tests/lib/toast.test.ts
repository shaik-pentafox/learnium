import { describe, it, expect } from 'vitest'
import { getErrorMessage } from '@/lib/toast'

describe('getErrorMessage', () => {
  it('reads the message from a normalized ApiError', () => {
    expect(
      getErrorMessage({ code: 'NOT_FOUND', message: 'gone', httpStatus: 404 }),
    ).toBe('gone')
  })

  it('reads the message from a native Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('falls back for unknown shapes', () => {
    expect(getErrorMessage('weird')).toBe('Unexpected error')
    expect(getErrorMessage(null)).toBe('Unexpected error')
  })
})
