-- AlterTable
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "color" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "llm_usage" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "modelId" INTEGER,
    "modelName" TEXT NOT NULL,
    "providerType" TEXT,
    "sessionId" INTEGER,
    "userId" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "llm_usage_createdAt_idx" ON "llm_usage"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "llm_usage_modelId_idx" ON "llm_usage"("modelId");
