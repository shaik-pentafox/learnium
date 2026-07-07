-- Enforce: at most one primary (isDefault = true) LlmModel per kind (chat / voice).
-- Prisma can't express partial indexes in schema.prisma, so this is hand-written.
-- NOTE: `prisma migrate dev` may report this index as drift (it isn't in the
-- schema) and try to drop it — discard that generated drop, this index is intentional.

-- 1. Demote any pre-existing duplicate defaults, keeping the lowest id per kind.
UPDATE "llm_models" AS m
SET "isDefault" = false
WHERE m."isDefault" = true
  AND m."id" <> (
    SELECT MIN(d."id")
    FROM "llm_models" AS d
    WHERE d."kind" = m."kind" AND d."isDefault" = true
  );

-- 2. Partial unique index: only one row per kind may have isDefault = true.
CREATE UNIQUE INDEX "llm_models_one_default_per_kind"
  ON "llm_models" ("kind")
  WHERE "isDefault" = true;
