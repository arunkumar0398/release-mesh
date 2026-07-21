import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createPricingServer } from "./server.js";
import { parsePricingMode, type PricingMode } from "./pricing-mode.js";

const openServers: ReturnType<typeof createPricingServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function startServer(mode: PricingMode): Promise<string> {
  const server = createPricingServer({ mode });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("Pricing fixture", () => {
  it("defaults to v1 and rejects unsupported modes", () => {
    expect(parsePricingMode(undefined)).toBe("v1");
    expect(parsePricingMode("v2.1")).toBe("v2.1");
    expect(() => parsePricingMode("latest")).toThrowError("Unsupported Pricing mode: latest");
  });

  it.each([
    ["v1", { currency: "INR", price: 1299 }],
    ["v2", { amount: 1299, currencyCode: "INR" }],
    ["v2.1", { amount: 1299, currency: "INR", currencyCode: "INR", price: 1299 }]
  ] as const)("serves the %s response from GET /pricing/:productId", async (mode, expectedBody) => {
    const baseUrl = await startServer(mode);

    const response = await fetch(`${baseUrl}/pricing/checkout-demo`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual(expectedBody);
  });

  it("serves the explicitly requested bundled candidate instead of the ambient default", async () => {
    const baseUrl = await startServer("v2");

    const response = await fetch(`${baseUrl}/pricing/checkout-demo?candidateVersion=v2.1`);

    await expect(response.json()).resolves.toEqual({
      amount: 1299,
      currency: "INR",
      currencyCode: "INR",
      price: 1299
    });
  });

  it("rejects non-GET methods on the Pricing route", async () => {
    const baseUrl = await startServer("v1");

    const response = await fetch(`${baseUrl}/pricing/checkout-demo`, { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("does not expose additional fixture routes", async () => {
    const baseUrl = await startServer("v1");

    const response = await fetch(`${baseUrl}/products/checkout-demo`);

    expect(response.status).toBe(404);
  });
});
