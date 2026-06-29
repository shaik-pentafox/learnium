import { apiGet } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

/** A selectable TTS voice from the backend catalog (voice_styles). */
export interface VoiceStyleOption {
  id: number
  name: string
  voiceId: string
  provider: string
}

/** GET /voice/voices — voices for the persona builder picker. */
export async function listVoices(): Promise<VoiceStyleOption[]> {
  const data = await apiGet<{ voices: VoiceStyleOption[] }>('/voice/voices')
  return data.voices
}

/** GET /voice/languages — BCP-47 codes the active voice provider supports. */
export async function listVoiceLanguages(): Promise<string[]> {
  const data = await apiGet<{ languages: string[] }>('/voice/languages')
  return data.languages
}

export const voiceKeys = {
  voices: () => [...queryKeys.voice, 'voices'] as const,
  languages: () => [...queryKeys.voice, 'languages'] as const,
}
