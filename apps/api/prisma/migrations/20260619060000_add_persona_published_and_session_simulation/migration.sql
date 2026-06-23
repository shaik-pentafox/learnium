-- AlterTable
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "isSimulation" BOOLEAN NOT NULL DEFAULT false;
