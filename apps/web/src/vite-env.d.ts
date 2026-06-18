/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full backend API base, e.g. http://localhost:3000/api/v1. When unset, the
   *  app falls back to the relative '/api/v1' (legacy vite-proxy mode). */
  readonly VITE_API_URL?: string
  readonly VITE_ENABLE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Fontsource variable packages ship CSS side-effects without type declarations.
declare module '@fontsource-variable/inter'
declare module '@fontsource-variable/jetbrains-mono'
