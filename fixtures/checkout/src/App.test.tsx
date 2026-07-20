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
  it.each([
    ["v1", { currency: "INR", price: 1299 }],
    ["v2.1", { amount: 1299, currency: "INR", currencyCode: "INR", price: 1299 }]
  ])("renders the v1 Checkout experience for Pricing %s", async (_version, responseBody) => {
    respondWith(responseBody);

    render(<App pricingBaseUrl="http://pricing.test" />);

    expect(await screen.findByText("INR 1299")).toBeInTheDocument();
    expect(screen.getByText("Pricing available")).toBeInTheDocument();
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
});
