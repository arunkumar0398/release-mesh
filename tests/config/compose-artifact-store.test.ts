import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface ComposeService {
  environment?: Record<string, string>;
  tmpfs?: string[];
  volumes?: string[];
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

describe("Docker Compose artifact storage", () => {
  it("uses disposable worker-local storage while keeping the API filesystem-independent", async () => {
    const source = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    const compose = parse(source) as ComposeConfig;
    const worker = compose.services.worker;
    const api = compose.services.api;

    expect(worker.environment).toMatchObject({
      ARTIFACT_DIRECTORY: "/artifacts",
      ARTIFACT_STORE: "local",
    });
    expect(worker.tmpfs).toContain("/artifacts");
    expect(worker.volumes ?? []).not.toContain("artifact_data:/artifacts");
    expect(compose.volumes).not.toHaveProperty("artifact_data");
    expect(api.environment).not.toHaveProperty("ARTIFACT_DIRECTORY");
    expect(api.volumes ?? []).not.toContain("artifact_data:/artifacts");
  });
});
