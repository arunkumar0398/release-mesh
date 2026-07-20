import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "./generated/prisma/client.js";
import { CatalogRepository } from "./repositories/catalog-repository.js";
import { seedCatalog } from "./seed.js";

const prisma = new PrismaClient();
const catalog = new CatalogRepository(prisma);

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.evidenceArtifact.deleteMany();
  await prisma.riskAssessment.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("seedCatalog", () => {
  it("is repeatable and exposes only the Checkout to Pricing dependency", async () => {
    await seedCatalog(prisma);
    await seedCatalog(prisma);

    await expect(catalog.listComponents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "checkout" }),
        expect.objectContaining({ name: "pricing" })
      ])
    );
    await expect(catalog.listDependencies()).resolves.toEqual([
      expect.objectContaining({
        consumer: expect.objectContaining({ name: "checkout" }),
        provider: expect.objectContaining({ name: "pricing" }),
        requiredEndpoints: ["GET /pricing/:productId"]
      })
    ]);
  });

  it("executes the package seed CLI on Windows-compatible file paths", async () => {
    const useWindowsShell = process.platform === "win32";
    const executable = useWindowsShell
      ? `"${resolve(dirname(process.execPath), "corepack.cmd")}" pnpm --filter @releasemesh/database seed`
      : "corepack";
    const child = spawn(
      executable,
      useWindowsShell ? [] : ["pnpm", "--filter", "@releasemesh/database", "seed"],
      {
        cwd: resolve(import.meta.dirname, "..", "..", ".."),
        env: process.env,
        shell: useWindowsShell,
        stdio: "pipe"
      }
    );
    const stderr: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const [exitCode] = (await once(child, "exit")) as [number];

    expect(exitCode, Buffer.concat(stderr).toString("utf8")).toBe(0);
    await expect(catalog.listComponents()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "checkout" }), expect.objectContaining({ name: "pricing" })])
    );
  }, 30_000);
});
