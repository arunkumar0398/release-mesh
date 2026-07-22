import {
  LocalArtifactStore,
  PostgresArtifactStore,
  type PrismaClient
} from "@releasemesh/database";
import type { ArtifactStore } from "@releasemesh/contracts";

export function createRunnerArtifactStore({
  artifactDirectory,
  mode,
  prisma
}: {
  artifactDirectory?: string;
  mode: string | undefined;
  prisma: PrismaClient;
}): ArtifactStore {
  if (mode === "postgres") return new PostgresArtifactStore(prisma);
  if (mode === "local") {
    if (!artifactDirectory?.trim()) throw new Error("ARTIFACT_DIRECTORY is required for local ARTIFACT_STORE");
    return new LocalArtifactStore({ prisma, rootDirectory: artifactDirectory });
  }
  throw new Error("ARTIFACT_STORE must be local or postgres");
}
