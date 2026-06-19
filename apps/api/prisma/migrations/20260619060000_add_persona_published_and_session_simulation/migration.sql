-- AlterTable
ALTER TABLE "personas" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false;
