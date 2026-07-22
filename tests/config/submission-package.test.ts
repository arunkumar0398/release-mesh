import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../", import.meta.url);

async function read(path: string): Promise<string> {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

describe("Build Week submission package", () => {
  it("documents public deployment, reset, health, repository access, and video steps", async () => {
    const [readme, deployment, runbook, submission] = await Promise.all([
      read("README.md"),
      read("docs/deployment.md"),
      read("docs/demo-runbook.md"),
      read("docs/submission.md")
    ]);

    for (const requiredText of [
      "https://arunkumar0398-releasemesh-shell.onrender.com",
      "Render static site",
      "paid background worker",
      "PostgresArtifactStore",
      "OPENAI_API_KEY",
      "DEPLOYED_CHECKOUT_URL",
      "DEPLOYED_PRICING_URL"
    ]) {
      expect(`${readme}\n${deployment}\n${submission}`).toContain(requiredText);
    }
    expect(runbook).toContain("x-demo-reset-token");
    expect(runbook).toContain("BLOCKED");
    expect(runbook).toContain("SAFE");
    expect(submission).toContain("private repository access");
    expect(submission).toContain("Video checklist");
    expect(submission).toContain("/feedback");
    expect(submission).toContain("primary Codex thread");
    expect(submission).not.toContain("new /feedback session");
  });

  it("ships the MIT licence", async () => {
    const licence = await read("LICENSE");
    expect(licence).toContain("MIT License");
    expect(licence).toContain("Permission is hereby granted");
  });
});
