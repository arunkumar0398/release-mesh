import { expect, test } from "@playwright/test";

import { createReleaseAndAwaitGate } from "./helpers/release-flow.js";

interface DeploymentConfig {
  apiUrl: string;
  catalogUrl: string;
  checkoutUrl: string;
  pricingUrl: string;
  releaseUrl: string;
  resetToken: string;
  shellUrl: string;
}

const deployment = readDeploymentConfig();
test.skip(deployment === null, "Set DEPLOYED_* URLs and DEMO_RESET_TOKEN to run public smoke tests");

test("public HTTPS deployment exposes health, federation headers, and both remotes", async ({ page, request }) => {
  const config = deployment as DeploymentConfig;
  const healthResponse = await request.get(`${config.apiUrl}/healthz`);
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({
    database: "up",
    redis: "up",
    status: "ok",
    worker: { fresh: true }
  });

  for (const remoteUrl of [config.catalogUrl, config.releaseUrl]) {
    const manifestResponse = await request.get(`${remoteUrl}/mf-manifest.json`);
    expect(manifestResponse.status()).toBe(200);
    expect(manifestResponse.headers()["cache-control"]).toContain("no-store");
    expect(manifestResponse.headers()["access-control-allow-origin"]).toBe(config.shellUrl);

    const assetPath = findHashedAsset(await manifestResponse.json());
    expect(assetPath).not.toBeNull();
    const assetResponse = await request.get(new URL(assetPath as string, `${remoteUrl}/`).toString());
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()["cache-control"]).toContain("max-age=31536000");
    expect(assetResponse.headers()["cache-control"]).toContain("immutable");
  }

  const pricingResponse = await request.get(`${config.pricingUrl}/pricing/checkout-demo`);
  expect(pricingResponse.status()).toBe(200);
  expect(pricingResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(await pricingResponse.json()).toEqual({ currency: "INR", price: 1299 });

  await page.goto(config.checkoutUrl);
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("INR 1299");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.goto(config.shellUrl);
  await expect(page.getByText("Catalog remote 0.1.0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Release remote 0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service Catalogue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
});

test("public demo resets and repeats BLOCKED then SAFE", async ({ page, request }) => {
  test.setTimeout(90_000);
  const config = deployment as DeploymentConfig;
  const resetResponse = await request.post(`${config.apiUrl}/demo/reset`, {
    data: {},
    headers: { "x-demo-reset-token": config.resetToken }
  });
  expect(resetResponse.status()).toBe(204);

  await page.goto(config.shellUrl);
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible({
    timeout: 20_000
  });
  const blockedReleaseId = await createReleaseAndAwaitGate(page, "v2", "BLOCKED");
  await expect(page.getByRole("region", { name: "Release evidence" })).toContainText(
    "CONTRACT_DIFF"
  );
  const safeReleaseId = await createReleaseAndAwaitGate(page, "v2.1", "SAFE");
  expect(safeReleaseId).not.toBe(blockedReleaseId);
});

function readDeploymentConfig(): DeploymentConfig | null {
  const config = {
    apiUrl: process.env.DEPLOYED_API_URL,
    catalogUrl: process.env.DEPLOYED_CATALOG_URL,
    checkoutUrl: process.env.DEPLOYED_CHECKOUT_URL,
    pricingUrl: process.env.DEPLOYED_PRICING_URL,
    releaseUrl: process.env.DEPLOYED_RELEASE_URL,
    resetToken: process.env.DEMO_RESET_TOKEN,
    shellUrl: process.env.DEPLOYED_SHELL_URL
  };
  if (Object.values(config).some((value) => !value)) return null;
  for (const [name, value] of Object.entries(config)) {
    const url = name === "resetToken" ? null : new URL(value as string);
    if (url && url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  }
  return config as DeploymentConfig;
}

function findHashedAsset(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/(?:^|\/)(assets\/[A-Za-z0-9_.-]+\.(?:css|js))(?:$|\?)/);
    return match?.[1] ?? null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findHashedAsset(entry);
      if (match) return match;
    }
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      const match = findHashedAsset(entry);
      if (match) return match;
    }
  }
  return null;
}
