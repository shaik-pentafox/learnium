-- Master catalog (seeded providers/models the admin configures from) + per-kind
-- primary models + persona voice-model pin.
-- NOTE: checkpoint_* tables (LangGraph PostgresSaver) are runtime-owned and
-- intentionally NOT touched by Prisma migrations.

-- AlterTable
ALTER TABLE "llm_models" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'chat',
ADD COLUMN     "masterModelId" INTEGER;

-- AlterTable
ALTER TABLE "llm_providers" DROP COLUMN "priority",
ADD COLUMN     "credentialHint" TEXT,
ADD COLUMN     "masterProviderId" INTEGER;

-- AlterTable
ALTER TABLE "personas" ADD COLUMN     "voiceModelId" INTEGER;

-- CreateTable
CREATE TABLE "master_providers" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "defaultBaseUrl" TEXT,
    "supports" TEXT[],

    CONSTRAINT "master_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_models" (
    "id" SERIAL NOT NULL,
    "masterProviderId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contextWindowTokens" INTEGER,
    "inputPricePerMillion" DOUBLE PRECISION,
    "outputPricePerMillion" DOUBLE PRECISION,
    "voicePipeline" TEXT,
    "languages" TEXT[],
    "voices" TEXT[],

    CONSTRAINT "master_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_providers_key_key" ON "master_providers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "master_models_masterProviderId_key_key" ON "master_models"("masterProviderId", "key");

-- AddForeignKey
ALTER TABLE "master_models" ADD CONSTRAINT "master_models_masterProviderId_fkey" FOREIGN KEY ("masterProviderId") REFERENCES "master_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_masterProviderId_fkey" FOREIGN KEY ("masterProviderId") REFERENCES "master_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_masterModelId_fkey" FOREIGN KEY ("masterModelId") REFERENCES "master_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_voiceModelId_fkey" FOREIGN KEY ("voiceModelId") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
