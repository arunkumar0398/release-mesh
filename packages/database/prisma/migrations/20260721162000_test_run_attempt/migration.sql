ALTER TABLE "TestRun" ADD COLUMN "attempt" INTEGER;

UPDATE "TestRun"
SET "attempt" = COALESCE((
  SELECT transition."attempt"
  FROM "ReleaseTransition" AS transition
  WHERE transition."releaseId" = "TestRun"."releaseId"
    AND transition."createdAt" <= COALESCE(
      "TestRun"."startedAt",
      "TestRun"."endedAt",
      CURRENT_TIMESTAMP
    )
  ORDER BY transition."createdAt" DESC
  LIMIT 1
), 0);

WITH ranked_runs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "releaseId", "attempt", "testId"
      ORDER BY "startedAt" DESC NULLS LAST, "id" DESC
    ) AS row_number
  FROM "TestRun"
)
DELETE FROM "EvidenceArtifact"
USING ranked_runs
WHERE "EvidenceArtifact"."testRunId" = ranked_runs."id"
  AND ranked_runs.row_number > 1;

WITH ranked_runs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "releaseId", "attempt", "testId"
      ORDER BY "startedAt" DESC NULLS LAST, "id" DESC
    ) AS row_number
  FROM "TestRun"
)
DELETE FROM "TestRun"
USING ranked_runs
WHERE "TestRun"."id" = ranked_runs."id"
  AND ranked_runs.row_number > 1;

ALTER TABLE "TestRun" ALTER COLUMN "attempt" SET NOT NULL;

CREATE UNIQUE INDEX "TestRun_releaseId_attempt_testId_key"
ON "TestRun"("releaseId", "attempt", "testId");
