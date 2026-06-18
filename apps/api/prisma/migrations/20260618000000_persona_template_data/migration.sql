-- AlterTable: structured authoring fields (source of truth) on personas.
ALTER TABLE "personas" ADD COLUMN "templateData" JSONB;

-- AlterTable: snapshot the structured fields on each persona version.
ALTER TABLE "persona_versions" ADD COLUMN "templateData" JSONB;
