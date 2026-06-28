-- Voice sessions: per-persona allowed languages + voice-session markers.

-- BCP-47 codes a trainee may pick when starting a voice session. Empty = text-only.
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Voice session flag + the trainee's chosen language (one of persona.languages).
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "isVoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "languageCode" TEXT;
