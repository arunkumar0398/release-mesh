import { describe, expect, it } from "vitest";

import { LocalArtifactStore, PostgresArtifactStore, type PrismaClient } from "@releasemesh/database";
import { createRunnerArtifactStore } from "./artifact-store.js";

const prisma = {} as PrismaClient;

describe("createRunnerArtifactStore", () => {
  it("selects the database-backed local store for Docker Compose", () => {
    expect(createRunnerArtifactStore({
      artifactDirectory: "/artifacts",
      mode: "local",
      prisma
    })).toBeInstanceOf(LocalArtifactStore);
  });

  it("selects PostgreSQL storage for Render", () => {
    expect(createRunnerArtifactStore({ mode: "postgres", prisma })).toBeInstanceOf(PostgresArtifactStore);
  });

  it.each(["", "filesystem", "s3"])("rejects unsupported artifact mode %s", (mode) => {
    expect(() => createRunnerArtifactStore({ mode, prisma })).toThrow("ARTIFACT_STORE");
  });

  it("requires a local directory for local mode", () => {
    expect(() => createRunnerArtifactStore({ mode: "local", prisma })).toThrow("ARTIFACT_DIRECTORY");
  });
});
