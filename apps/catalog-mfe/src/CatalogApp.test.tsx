// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCatalog, type CatalogSnapshot } from "./api.js";
import { CatalogApp } from "./CatalogApp.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const snapshot: CatalogSnapshot = {
  components: [
    {
      id: "checkout-id",
      kind: "FRONTEND",
      name: "checkout",
      ownerTeam: "checkout-platform",
      providedContracts: [],
      versions: []
    },
    {
      id: "pricing-id",
      kind: "FIXTURE",
      name: "pricing",
      ownerTeam: "pricing-platform",
      providedContracts: [{
        endpoint: "GET /pricing/:productId",
        id: "pricing-contract",
        schema: { currency: "INR", price: 1299 },
        version: "1.0.0"
      }],
      versions: [
        { id: "pricing-v1", version: "1.0.0" },
        { id: "pricing-v2", version: "v2" },
        { id: "pricing-v21", version: "v2.1" }
      ]
    }
  ],
  dependencies: [{
    consumer: { id: "checkout-id", name: "checkout" },
    expectedContractVersion: "1.0.0",
    id: "checkout-pricing",
    owningTeam: "checkout-platform",
    provider: { id: "pricing-id", name: "pricing" },
    requiredEndpoints: ["GET /pricing/:productId"]
  }]
};

describe("CatalogApp", () => {
  it("renders only the seeded Checkout and Pricing catalogue", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue(snapshot);

    render(<CatalogApp loadSnapshot={loadSnapshot} />);

    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getAllByText("checkout-platform")).toHaveLength(2);
    expect(screen.getByText("pricing-platform")).toBeInTheDocument();
    expect(screen.getAllByText("GET /pricing/:productId")).toHaveLength(2);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v2.1")).toBeInTheDocument();
    expect(screen.getByText("Checkout → Pricing")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Order" })).not.toBeInTheDocument();
    expect(loadSnapshot).toHaveBeenCalledOnce();
  });

  it("shows a contained catalogue error when the API is unavailable", async () => {
    render(<CatalogApp loadSnapshot={() => Promise.reject(new Error("catalogue unavailable"))} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue data unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("catalogue unavailable");
  });
});

describe("loadCatalog", () => {
  it("loads details for only the seeded component names and their dependency", async () => {
    const responses = new Map<string, unknown>([
      ["/api/components", [
        { id: "checkout-id", kind: "FRONTEND", name: "checkout", ownerTeam: "checkout-platform" },
        { id: "order-id", kind: "SERVICE", name: "order", ownerTeam: "order-platform" },
        { id: "pricing-id", kind: "FIXTURE", name: "pricing", ownerTeam: "pricing-platform" }
      ]],
      ["/api/components/checkout-id", snapshot.components[0]],
      ["/api/components/pricing-id", snapshot.components[1]],
      ["/api/dependencies", [
        snapshot.dependencies[0],
        {
          consumer: { id: "order-id", name: "order" },
          expectedContractVersion: "1.0.0",
          id: "order-pricing",
          owningTeam: "order-platform",
          provider: { id: "pricing-id", name: "pricing" },
          requiredEndpoints: ["GET /pricing/:productId"]
        }
      ]]
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = responses.get(url);
      return body === undefined
        ? new Response(null, { status: 404 })
        : Response.json(body);
    }) as typeof fetch;

    await expect(loadCatalog("/api", fetchImpl)).resolves.toEqual(snapshot);
    expect(fetchImpl).not.toHaveBeenCalledWith("/api/components/order-id", expect.anything());
  });

  it("rejects malformed catalogue payloads", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      return Response.json(url.endsWith("/components") ? { components: [] } : []);
    }) as typeof fetch;

    await expect(loadCatalog("/api", fetchImpl)).rejects.toThrow("Catalogue components response is invalid");
  });
});
