import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { decideReleaseGate } from "@releasemesh/contracts";
import { createPricingServer } from "@releasemesh/pricing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPricingApiCheck, toPricingApiGateState } from "./api-check.js";

const openServers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
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

function createTrustedPricingApiCheck(
  options: Omit<Parameters<typeof createPricingApiCheck>[0], "trustedPricingOrigins"> & {
    trustedPricingOrigins?: readonly string[];
  }
) {
  return createPricingApiCheck({
    trustedPricingOrigins: options.trustedPricingOrigins ?? [new URL(options.pricingBaseUrl).origin],
    ...options
  });
}

describe("createPricingApiCheck", () => {
  it("fails against Pricing v2 when the Checkout fields are absent", async () => {
    const runCheck = createTrustedPricingApiCheck({ pricingBaseUrl: await startPricing("v2") });

    await expect(runCheck()).resolves.toEqual({
      missingFields: ["price", "currency"],
      outcome: "failed",
      statusCode: 200,
      testId: "api-pricing"
    });
  });

  it("passes against Pricing v2.1", async () => {
    const runCheck = createTrustedPricingApiCheck({ pricingBaseUrl: await startPricing("v2.1") });

    await expect(runCheck()).resolves.toEqual({
      missingFields: [],
      outcome: "passed",
      statusCode: 200,
      testId: "api-pricing"
    });
  });

  it("returns an error when Pricing returns a non-success status", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const runCheck = createTrustedPricingApiCheck({ fetchImpl, pricingBaseUrl: "http://pricing.test" });

    await expect(runCheck()).resolves.toEqual({
      errorCode: "HTTP_ERROR",
      outcome: "error",
      statusCode: 503,
      testId: "api-pricing"
    });
  });

  it("aborts an unresponsive Pricing request at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    const runCheck = createTrustedPricingApiCheck({
      fetchImpl,
      pricingBaseUrl: "http://pricing.test",
      timeoutMs: 50
    });

    const resultPromise = runCheck();
    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({
      errorCode: "TIMEOUT",
      outcome: "error",
      statusCode: null,
      testId: "api-pricing"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://pricing.test/pricing/checkout-demo",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it("times out when Pricing stalls while reading the response body", async () => {
    vi.useFakeTimers();
    const response = {
      json: () => new Promise<unknown>(() => undefined),
      ok: true,
      status: 200
    } as Response;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const runCheck = createTrustedPricingApiCheck({
      fetchImpl,
      pricingBaseUrl: "http://pricing.test",
      timeoutMs: 50
    });

    const resultPromise = runCheck();
    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({
      errorCode: "TIMEOUT",
      outcome: "error",
      statusCode: null,
      testId: "api-pricing"
    });
  });

  it("returns an error when the Pricing network request rejects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const runCheck = createTrustedPricingApiCheck({ fetchImpl, pricingBaseUrl: "http://pricing.test" });

    await expect(runCheck()).resolves.toEqual({
      errorCode: "NETWORK_ERROR",
      outcome: "error",
      statusCode: null,
      testId: "api-pricing"
    });
  });

  it("returns an error when Pricing responds with malformed JSON", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));
    const runCheck = createTrustedPricingApiCheck({ fetchImpl, pricingBaseUrl: "http://pricing.test" });

    await expect(runCheck()).resolves.toEqual({
      errorCode: "INVALID_JSON",
      outcome: "error",
      statusCode: 200,
      testId: "api-pricing"
    });
  });

  it("maps check errors to an incomplete required check and deterministic ERROR", () => {
    const gateState = toPricingApiGateState({
      errorCode: "TIMEOUT",
      outcome: "error",
      statusCode: null,
      testId: "api-pricing"
    });

    expect(gateState).toEqual({ requiredChecksCompleted: false });
    expect(
      decideReleaseGate({
        evidenceComplete: true,
        expectedMandatoryTestIds: ["api-pricing"],
        hasIncompatibleRegisteredDependency: false,
        mandatoryTests: [],
        requiredChecksCompleted: gateState.requiredChecksCompleted
      })
    ).toBe("ERROR");
  });

  it.each([
    ["passed", "PASSED"],
    ["failed", "FAILED"]
  ] as const)("maps a %s result to a completed mandatory test", (outcome, mandatoryTestStatus) => {
    expect(
      toPricingApiGateState({
        missingFields: outcome === "passed" ? [] : ["price", "currency"],
        outcome,
        statusCode: 200,
        testId: "api-pricing"
      })
    ).toEqual({ mandatoryTestStatus, requiredChecksCompleted: true });
  });

  it.each([
    ["origin", "http://169.254.169.254", ["http://pricing.test"]],
    ["credentials", "http://user:password@pricing.test", ["http://pricing.test"]],
    ["path", "http://pricing.test/internal", ["http://pricing.test"]]
  ])("rejects an untrusted Pricing %s", (_scenario, pricingBaseUrl, trustedPricingOrigins) => {
    expect(() => createPricingApiCheck({ pricingBaseUrl, trustedPricingOrigins })).toThrow(
      "Untrusted Pricing URL"
    );
  });

  it("disables redirects for the trusted Pricing request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { headers: { location: "http://untrusted.test" }, status: 302 }));
    const runCheck = createTrustedPricingApiCheck({ fetchImpl, pricingBaseUrl: "https://pricing.test" });

    await expect(runCheck()).resolves.toMatchObject({ errorCode: "HTTP_ERROR", outcome: "error" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://pricing.test/pricing/checkout-demo",
      expect.objectContaining({ redirect: "error" })
    );
  });
});
