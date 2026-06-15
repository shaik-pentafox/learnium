-- AlterTable
ALTER TABLE "personas" ADD COLUMN     "conversationModelId" INTEGER,
ADD COLUMN     "scoringModelId" INTEGER;

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT,
    "credentialRef" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "monthlyBudgetUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "capabilities" TEXT[],
    "contextWindowTokens" INTEGER,
    "inputPricePerMillion" DOUBLE PRECISION,
    "outputPricePerMillion" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_providers_name_key" ON "llm_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "llm_models_name_key" ON "llm_models"("name");

-- AddForeignKey
ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "llm_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_conversationModelId_fkey" FOREIGN KEY ("conversationModelId") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_scoringModelId_fkey" FOREIGN KEY ("scoringModelId") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
