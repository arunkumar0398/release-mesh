CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "ComponentKind" AS ENUM ('BACKEND', 'FIXTURE', 'FRONTEND');
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'VALIDATING', 'QUEUED', 'TESTING', 'ANALYZING', 'SAFE', 'BLOCKED', 'ERROR');
CREATE TYPE "ArtifactStorageKind" AS ENUM ('LOCAL', 'POSTGRES');

CREATE TABLE "Component" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ComponentKind" NOT NULL,
  "ownerTeam" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComponentVersion" (
  "id" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComponentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Dependency" (
  "id" TEXT NOT NULL,
  "consumerId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "expectedContractVersion" TEXT NOT NULL,
  "requiredEndpoints" TEXT[] NOT NULL,
  "owningTeam" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contract" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "schema" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReleaseCandidate" (
  "id" TEXT NOT NULL,
  "componentVersionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReleaseCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReleaseTransition" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "fromStatus" "ReleaseStatus",
  "toStatus" "ReleaseStatus" NOT NULL,
  "attempt" INTEGER NOT NULL,
  "reason" TEXT,
  "errorCode" TEXT,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseTransition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestRun" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceArtifact" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "testRunId" TEXT,
  "kind" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "storageKind" "ArtifactStorageKind" NOT NULL,
  "jsonContent" JSONB,
  "textContent" TEXT,
  "binaryContent" BYTEA,
  "localPath" TEXT,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskAssessment" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "assessment" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerHeartbeat" (
  "workerId" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE UNIQUE INDEX "Component_name_key" ON "Component"("name");
CREATE UNIQUE INDEX "ComponentVersion_componentId_version_key" ON "ComponentVersion"("componentId", "version");
CREATE UNIQUE INDEX "Dependency_consumerId_providerId_key" ON "Dependency"("consumerId", "providerId");
CREATE UNIQUE INDEX "Contract_providerId_version_endpoint_key" ON "Contract"("providerId", "version", "endpoint");
CREATE UNIQUE INDEX "ReleaseCandidate_idempotencyKey_key" ON "ReleaseCandidate"("idempotencyKey");
CREATE INDEX "ReleaseTransition_releaseId_createdAt_idx" ON "ReleaseTransition"("releaseId", "createdAt");
CREATE INDEX "TestRun_releaseId_idx" ON "TestRun"("releaseId");
CREATE INDEX "EvidenceArtifact_releaseId_idx" ON "EvidenceArtifact"("releaseId");
CREATE UNIQUE INDEX "RiskAssessment_releaseId_key" ON "RiskAssessment"("releaseId");

ALTER TABLE "ComponentVersion" ADD CONSTRAINT "ComponentVersion_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseCandidate" ADD CONSTRAINT "ReleaseCandidate_componentVersionId_fkey" FOREIGN KEY ("componentVersionId") REFERENCES "ComponentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseTransition" ADD CONSTRAINT "ReleaseTransition_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
