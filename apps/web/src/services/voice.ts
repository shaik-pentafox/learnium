import { apiGet, http } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

/** A selectable TTS voice from the backend catalog. */
export interface VoiceStyleOption {
  id: number
  name: string
  voiceId: string
  provider: string
}

/** GET /voice/voices — voices of the resolved voice model (pin or primary). */
export async function listVoices(voiceModelId?: number): Promise<VoiceStyleOption[]> {
  const data = await apiGet<{ voices: VoiceStyleOption[] }>('/voice/voices', {
    params: voiceModelId ? { voiceModelId } : {},
  })
  return data.voices
}

/** GET /voice/languages — BCP-47 codes of the resolved voice model. */
export async function listVoiceLanguages(voiceModelId?: number): Promise<string[]> {
  const data = await apiGet<{ languages: string[] }>('/voice/languages', {
    params: voiceModelId ? { voiceModelId } : {},
  })
  return data.languages
}

/** GET /voice/preview — short sample of a voice speaking the given language.
 *  Returns an object URL for an <audio> element; caller revokes it when done. */
export async function fetchVoicePreview(
  voiceId: string,
  languageCode: string,
  voiceModelId?: number,
): Promise<string> {
  const res = await http.get('/voice/preview', {
    params: { voiceId, languageCode, ...(voiceModelId ? { voiceModelId } : {}) },
    responseType: 'blob',
  })
  return URL.createObjectURL(res.data as Blob)
}

export const voiceKeys = {
  voices: (voiceModelId?: number) =>
    [...queryKeys.voice, 'voices', voiceModelId ?? 'primary'] as const,
  languages: (voiceModelId?: number) =>
    [...queryKeys.voice, 'languages', voiceModelId ?? 'primary'] as const,
}
