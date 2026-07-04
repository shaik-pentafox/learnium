-- Persona-level provider voice name (e.g. 'alloy', 'Puck'). Must be one of the
-- selected voice model's catalog voices; null = the model's first voice.

-- AlterTable
ALTER TABLE "personas" ADD COLUMN "voiceId" TEXT;
