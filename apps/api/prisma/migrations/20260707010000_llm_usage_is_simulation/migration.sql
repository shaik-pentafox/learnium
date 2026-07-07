-- Tag LLM usage from persona test/simulation sessions so cost analytics can
-- exclude it (a dry-run against a persona must not inflate real spend metrics).
ALTER TABLE "llm_usage" ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false;
