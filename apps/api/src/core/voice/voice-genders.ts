export type VoiceGender = 'male' | 'female';

/**
 * Perceived voice genders, used ONLY to filter the persona builder's voice
 * picker by the persona's gender. Never affects synthesis — the provider always
 * speaks whatever `voiceId` is chosen.
 *
 * A voice absent from this map has no reliable gender designation and is shown
 * for a persona of any gender (fail-open, so filtering never hides everything).
 *
 * Sources:
 *  - Gemini Live prebuilt voices — documented male/female in Google's TTS docs.
 *  - OpenAI Realtime — only `marin` (female) and `cedar` (male) are officially
 *    gendered; the classic voices are community-perceived, and `alloy` is
 *    marketed neutral, so it is intentionally omitted (shows for anyone).
 */
export const VOICE_GENDERS: Record<string, VoiceGender> = {
  // ── OpenAI Realtime ──
  ash: 'male',
  ballad: 'male',
  echo: 'male',
  verse: 'male',
  cedar: 'male',
  coral: 'female',
  sage: 'female',
  shimmer: 'female',
  marin: 'female',
  // alloy → neutral, intentionally unlisted

  // ── Gemini Live ──
  Puck: 'male',
  Charon: 'male',
  Fenrir: 'male',
  Orus: 'male',
  Aoede: 'female',
  Kore: 'female',
  Leda: 'female',
  Zephyr: 'female',
};
