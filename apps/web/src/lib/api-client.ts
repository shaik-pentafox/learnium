import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios'
import type { PaginationMeta } from '@learnium/contracts'
import { useAuthStore } from '@/stores/auth'

/** Normalized error surfaced to the UI (from the API error envelope). */
export interface ApiError {
  code: string
  message: string
  httpStatus: number
  details?: unknown
}

interface SuccessEnvelope<T> {
  status: 'success'
  message: string
  data: T
  meta?: PaginationMeta
}

interface ErrorEnvelope {
  status: 'error'
  message: string
  code: string
  details?: unknown
}

const http: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // refresh token rides in an httpOnly cookie
  headers: { 'Content-Type': 'application/json' },
})

// Attach the in-memory access token to every request.
http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// --- 401 refresh: single-flight rotation + replay --------------------------
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post<SuccessEnvelope<{ accessToken: string }>>(
      '/api/v1/auth/refresh',
      {},
      { withCredentials: true },
    )
    const token = res.data.data.accessToken
    useAuthStore.getState().setAccessToken(token)
    return token
  } catch {
    useAuthStore.getState().clear()
    return null
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ErrorEnvelope>) => {
    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined
    const status = error.response?.status

    const isRefreshable =
      status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/login')

    if (isRefreshable) {
      original._retried = true
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null
      })
      const token = await refreshPromise
      if (token) {
        return http(original)
      }
    }

    return Promise.reject(normalizeError(error))
  },
)

function normalizeError(error: AxiosError<ErrorEnvelope>): ApiError {
  const envelope = error.response?.data
  if (envelope?.status === 'error') {
    return {
      code: envelope.code,
      message: envelope.message,
      httpStatus: error.response?.status ?? 0,
      details: envelope.details,
    }
  }
  return {
    code: 'NETWORK_ERROR',
    message: error.message || 'Network error',
    httpStatus: error.response?.status ?? 0,
  }
}

// --- typed helpers (envelope-unwrapped) ------------------------------------

export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await http.get<SuccessEnvelope<T>>(url, config)
  return res.data.data
}

export async function apiGetPaginated<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const res = await http.get<SuccessEnvelope<T[]>>(url, config)
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await http.post<SuccessEnvelope<T>>(url, body, config)
  return res.data.data
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await http.patch<SuccessEnvelope<T>>(url, body, config)
  return res.data.data
}

export async function apiDelete<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await http.delete<SuccessEnvelope<T>>(url, config)
  return res.data.data
}

export { http }
