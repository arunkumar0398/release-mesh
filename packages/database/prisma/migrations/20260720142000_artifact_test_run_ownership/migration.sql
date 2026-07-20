CREATE UNIQUE INDEX "TestRun_id_releaseId_key" ON "TestRun"("id", "releaseId");

ALTER TABLE "EvidenceArtifact" DROP CONSTRAINT "EvidenceArtifact_testRunId_fkey";

ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_testRunId_releaseId_fkey"
  FOREIGN KEY ("testRunId", "releaseId") REFERENCES "TestRun"("id", "releaseId") ON DELETE RESTRICT ON UPDATE CASCADE;
