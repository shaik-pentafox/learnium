import toast from 'react-hot-toast'
import type { ApiError } from '@/lib/api-client'

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  )
}

export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'Unexpected error'
}

export const notify = {
  success: (message: string) => toast.success(message),
  error: (error: unknown) => toast.error(getErrorMessage(error)),
  message: (message: string) => toast(message),
  promise: <T>(
    promise: Promise<T>,
    msgs: { loading: string; success: string; error?: string },
  ) =>
    toast.promise(promise, {
      loading: msgs.loading,
      success: msgs.success,
      error: (err) => msgs.error ?? getErrorMessage(err),
    }),
}
