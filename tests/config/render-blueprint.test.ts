import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface HeaderRule {
  name: string;
  path: string;
  value: string;
}

interface RenderService {
  autoDeployTrigger?: string;
  buildCommand?: string;
  dockerCommand?: string;
  dockerfilePath?: string;
  envVars?: Array<Record<string, unknown>>;
  headers?: HeaderRule[];
  healthCheckPath?: string;
  name: string;
  plan?: string;
  preDeployCommand?: string;
  runtime?: string;
  staticPublishPath?: string;
  type: string;
}

interface RenderBlueprint {
  databases: Array<Record<string, unknown>>;
  services: RenderService[];
}

const repositoryRoot = new URL("../../", import.meta.url);

async function readBlueprint(): Promise<RenderBlueprint> {
  return parse(await readFile(new URL("render.yaml", repositoryRoot), "utf8")) as RenderBlueprint;
}

function findService(blueprint: RenderBlueprint, name: string): RenderService {
  const service = blueprint.services.find((candidate) => candidate.name === name);
  if (!service) throw new Error(`Missing Render service: ${name}`);
  return service;
}

function expectHeader(
  service: RenderService,
  path: string,
  name: string,
  value: string
): void {
  expect(service.headers).toContainEqual({ name, path, value });
}

describe("Render Blueprint", () => {
  it("deploys Shell, Catalog, Release, and Checkout as static sites", async () => {
    const blueprint = await readBlueprint();
    const staticSites = [
      ["arunkumar0398-releasemesh-shell", "@releasemesh/shell", "./apps/shell/dist"],
      ["arunkumar0398-releasemesh-catalog", "@releasemesh/catalog-mfe", "./apps/catalog-mfe/dist"],
      ["arunkumar0398-releasemesh-release", "@releasemesh/release-mfe", "./apps/release-mfe/dist"],
      ["arunkumar0398-releasemesh-checkout", "@releasemesh/checkout", "./fixtures/checkout/dist"]
    ] as const;

    for (const [name, workspace, publishPath] of staticSites) {
      const service = findService(blueprint, name);
      expect(service).toMatchObject({
        autoDeployTrigger: "commit",
        runtime: "static",
        staticPublishPath: publishPath,
        type: "web"
      });
      expect(service.buildCommand).toContain("corepack pnpm install --frozen-lockfile");
      expect(service.buildCommand).toContain(`corepack pnpm --filter ${workspace} build`);
      expectHeader(service, "/assets/*", "Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  it("keeps remote manifests stable, uncached, and cross-origin accessible to Shell", async () => {
    const blueprint = await readBlueprint();
    const shellOrigin = "https://arunkumar0398-releasemesh-shell.onrender.com";

    for (const name of [
      "arunkumar0398-releasemesh-catalog",
      "arunkumar0398-releasemesh-release"
    ]) {
      const service = findService(blueprint, name);
      expectHeader(service, "/mf-manifest.json", "Cache-Control", "no-store");
      expectHeader(service, "/remoteEntry.js", "Cache-Control", "no-store");
      expectHeader(service, "/*", "Access-Control-Allow-Origin", shellOrigin);
    }

    const shell = findService(blueprint, "arunkumar0398-releasemesh-shell");
    expectHeader(shell, "/remotes.json", "Cache-Control", "no-store");
    expect(shell.buildCommand).toContain("apps/shell/render-remotes.json");

    const remotes = JSON.parse(
      await readFile(new URL("apps/shell/render-remotes.json", repositoryRoot), "utf8")
    ) as Record<string, { apiBaseUrl: string; manifestUrl: string }>;
    expect(remotes).toEqual({
      catalog: {
        apiBaseUrl: "https://arunkumar0398-releasemesh-api.onrender.com",
        manifestUrl: "https://arunkumar0398-releasemesh-catalog.onrender.com/mf-manifest.json"
      },
      release: {
        apiBaseUrl: "https://arunkumar0398-releasemesh-api.onrender.com",
        manifestUrl: "https://arunkumar0398-releasemesh-release.onrender.com/mf-manifest.json"
      }
    });
  });

  it("uses public web fixtures, hosted data stores, and a paid non-HTTP runner", async () => {
    const blueprint = await readBlueprint();
    const api = findService(blueprint, "arunkumar0398-releasemesh-api");
    expect(api).toMatchObject({
      autoDeployTrigger: "commit",
      healthCheckPath: "/healthz",
      plan: "free",
      type: "web"
    });
    expect(api.preDeployCommand).toBeUndefined();
    for (const command of [
      "@releasemesh/database generate",
      "@releasemesh/database migrate:deploy",
      "@releasemesh/database seed",
      "@releasemesh/control-plane-api start"
    ]) {
      expect(api.dockerCommand).toContain(command);
    }
    const checkout = findService(blueprint, "arunkumar0398-releasemesh-checkout");
    expect(checkout.envVars).toContainEqual({
      key: "VITE_PRICING_BASE_URL",
      value: "https://arunkumar0398-releasemesh-pricing.onrender.com"
    });

    const pricing = findService(blueprint, "arunkumar0398-releasemesh-pricing");
    expect(pricing).toMatchObject({
      autoDeployTrigger: "commit",
      healthCheckPath: "/pricing/health",
      type: "web"
    });
    expect(pricing.envVars).toContainEqual({ key: "PRICING_MODE", value: "v1" });

    const runner = findService(blueprint, "arunkumar0398-releasemesh-runner");
    expect(runner).toMatchObject({
      autoDeployTrigger: "commit",
      dockerfilePath: "./Dockerfile.worker",
      plan: "starter",
      type: "worker"
    });
    expect(runner.dockerCommand).toMatch(/^\/bin\/sh -c/);
    expect(runner.healthCheckPath).toBeUndefined();
    expect(runner.envVars).toContainEqual({ key: "ARTIFACT_STORE", value: "postgres" });
    expect(runner.envVars).toContainEqual({ key: "OPENAI_API_KEY", sync: false });

    expect(findService(blueprint, "arunkumar0398-releasemesh-redis")).toMatchObject({
      type: "keyvalue"
    });
    expect(blueprint.databases).toContainEqual(expect.objectContaining({
      name: "arunkumar0398-releasemesh-db"
    }));
  });
});
