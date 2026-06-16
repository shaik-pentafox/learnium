/**
 * Root query-key namespaces. Per-feature `keys.ts` factories compose off these
 * so there are no inline string keys anywhere in the app.
 */
export const queryKeys = {
  auth: ['auth'] as const,
  users: ['users'] as const,
  personas: ['personas'] as const,
  roleplay: ['roleplay'] as const,
  analytics: ['analytics'] as const,
  llmOps: ['llm-ops'] as const,
} as const
