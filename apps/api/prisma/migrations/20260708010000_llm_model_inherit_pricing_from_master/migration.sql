-- llm_models pricing/context become inherit-from-master OVERRIDES.
-- Master-linked rows drop their redundant copies and read from the master at
-- runtime (override ?? master), matching how voice metadata already resolves.
-- Custom rows (masterModelId IS NULL) keep their own values.

-- pricingUnit is now an optional override (NULL = inherit from master).
-- Drop the NOT NULL/default BEFORE nulling copies, or the UPDATE violates it.
ALTER TABLE "llm_models" ALTER COLUMN "pricingUnit" DROP DEFAULT;
ALTER TABLE "llm_models" ALTER COLUMN "pricingUnit" DROP NOT NULL;

UPDATE "llm_models"
SET "contextWindowTokens"   = NULL,
    "pricingUnit"           = NULL,
    "inputPricePerMillion"  = NULL,
    "outputPricePerMillion" = NULL,
    "inputPricePerMinute"   = NULL,
    "outputPricePerMinute"  = NULL
WHERE "masterModelId" IS NOT NULL;
