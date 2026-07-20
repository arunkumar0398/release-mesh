import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createPricingServer } from "@releasemesh/pricing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPricingApiCheck } from "./api-check.js";

const openServers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function startPricing(mode: "v2" | "v2.1"): Promise<string> {
  const server = createPricingServer({ mode });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("createPricingApiCheck", () => {
  it("fails against Pricing v2 when the Checkout fields are absent", async () => {
    const runCheck = createPricingApiCheck({ pricingBaseUrl: await startPricing("v2") });

    await expect(runCheck()).resolves.toEqual({
      missingFields: ["price", "currency"],
      passed: false,
      statusCode: 200,
      testId: "api-pricing"
    });
  });

  it("passes against Pricing v2.1", async () => {
    const runCheck = createPricingApiCheck({ pricingBaseUrl: await startPricing("v2.1") });

    await expect(runCheck()).resolves.toEqual({
      missingFields: [],
      passed: true,
      statusCode: 200,
      testId: "api-pricing"
    });
  });

  it("fails deterministically when Pricing returns a non-success status", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const runCheck = createPricingApiCheck({ fetchImpl, pricingBaseUrl: "http://pricing.test" });

    await expect(runCheck()).resolves.toEqual({
      missingFields: ["price", "currency"],
      passed: false,
      statusCode: 503,
      testId: "api-pricing"
    });
  });
});
