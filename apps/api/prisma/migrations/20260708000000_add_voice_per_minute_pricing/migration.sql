-- Per-time pricing for voice models (STT/TTS/per-minute providers).
-- Native S2S voice + chat stay 'token'; per-minute providers use the *PerMinute cols.

ALTER TABLE "master_models"
  ADD COLUMN "pricingUnit" TEXT NOT NULL DEFAULT 'token',
  ADD COLUMN "inputPricePerMinute" DOUBLE PRECISION,
  ADD COLUMN "outputPricePerMinute" DOUBLE PRECISION;

ALTER TABLE "llm_models"
  ADD COLUMN "pricingUnit" TEXT NOT NULL DEFAULT 'token',
  ADD COLUMN "inputPricePerMinute" DOUBLE PRECISION,
  ADD COLUMN "outputPricePerMinute" DOUBLE PRECISION;
