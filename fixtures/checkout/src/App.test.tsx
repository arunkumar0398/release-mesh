// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respondWith(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    )
  );
}

describe("Checkout", () => {
  it("announces that pricing is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(<App pricingBaseUrl="http://pricing.test" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading pricing");
  });

  it.each([
    ["v1", { currency: "INR", price: 1299 }],
    ["v2.1", { amount: 1299, currency: "INR", currencyCode: "INR", price: 1299 }]
  ])("renders the v1 Checkout experience for Pricing %s", async (_version, responseBody) => {
    respondWith(responseBody);

    render(<App pricingBaseUrl="http://pricing.test" />);

    expect(await screen.findByText("INR 1299")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Pricing available");
    expect(screen.getByRole("status")).toHaveTextContent("INR 1299");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("visibly fails when Pricing v2 removes the v1 fields", async () => {
    respondWith({ amount: 1299, currencyCode: "INR" });

    render(<App pricingBaseUrl="http://pricing.test" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pricing response is incompatible: missing price, currency"
    );
  });

  it("binds the Checkout request to the selected bundled candidate", async () => {
    respondWith({ amount: 1299, currency: "INR", currencyCode: "INR", price: 1299 });

    render(<App candidateVersion="v2.1" pricingBaseUrl="http://pricing.test" />);

    expect(await screen.findByText("INR 1299")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "http://pricing.test/pricing/checkout-demo?candidateVersion=v2.1",
      undefined
    );
  });
});
