-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assignedPersonaId" INTEGER;

-- CreateTable
CREATE TABLE "voice_styles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,

    CONSTRAINT "voice_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "customInstructions" TEXT,
    "voiceStyleId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_versions" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "customInstructions" TEXT,
    "snapshotData" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_criteria" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "score_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_styles_name_key" ON "voice_styles"("name");

-- CreateIndex
CREATE INDEX "persona_versions_personaId_idx" ON "persona_versions"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "persona_versions_personaId_version_key" ON "persona_versions"("personaId", "version");

-- CreateIndex
CREATE INDEX "score_criteria_personaId_idx" ON "score_criteria"("personaId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assignedPersonaId_fkey" FOREIGN KEY ("assignedPersonaId") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_voiceStyleId_fkey" FOREIGN KEY ("voiceStyleId") REFERENCES "voice_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_criteria" ADD CONSTRAINT "score_criteria_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
