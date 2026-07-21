// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReleaseMesh Shell", () => {
  const catalogRemote = {
    CatalogApp: ({ apiBaseUrl }: { apiBaseUrl?: string }) => (
      <h2>{`Federated Service Catalogue via ${apiBaseUrl}`}</h2>
    ),
    apiBaseUrl: "https://api.example/",
    catalogMfeVersion: "0.1.0"
  };
  const releaseRemote = {
      ReleaseApp: ({ apiBaseUrl }: { apiBaseUrl?: string }) => (
        <h2>{`Federated Release Centre via ${apiBaseUrl}`}</h2>
      ),
      apiBaseUrl: "https://api.example/",
      releaseMfeVersion: "0.1.0"
  };

  it("loads Catalog and Release independently and displays their versions", async () => {
    const loadCatalogRemote = vi.fn().mockResolvedValue(catalogRemote);
    const loadReleaseRemote = vi.fn().mockResolvedValue(releaseRemote);

    render(<App loadCatalogRemote={loadCatalogRemote} loadReleaseRemote={loadReleaseRemote} />);

    expect(screen.getByRole("banner")).toHaveTextContent("ReleaseMesh");
    expect(await screen.findByRole("heading", {
      name: "Federated Service Catalogue via https://api.example/"
    })).toBeInTheDocument();
    expect(await screen.findByRole("heading", {
      name: "Federated Release Centre via https://api.example/"
    })).toBeInTheDocument();
    expect(screen.getByText("Catalog remote 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("Release remote 0.1.0")).toBeInTheDocument();
    expect(loadCatalogRemote).toHaveBeenCalledOnce();
    expect(loadReleaseRemote).toHaveBeenCalledOnce();
  });

  it("keeps Release usable when the Catalog manifest is unavailable", async () => {
    const loadCatalogRemote = vi.fn().mockRejectedValue(new Error("manifest unavailable"));
    const loadReleaseRemote = vi.fn().mockResolvedValue(releaseRemote);

    render(<App loadCatalogRemote={loadCatalogRemote} loadReleaseRemote={loadReleaseRemote} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog remote unavailable");
    expect(await screen.findByRole("heading", {
      name: "Federated Release Centre via https://api.example/"
    })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toHaveTextContent("Service Catalogue");
    expect(screen.getByRole("navigation")).toHaveTextContent("Release Centre");
  });

  it("keeps the Shell usable when the Release manifest is unavailable", async () => {
    const loadCatalogRemote = vi.fn().mockResolvedValue(catalogRemote);
    const loadReleaseRemote = vi.fn().mockRejectedValue(new Error("manifest unavailable"));

    render(<App loadCatalogRemote={loadCatalogRemote} loadReleaseRemote={loadReleaseRemote} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Release remote unavailable");
    expect(screen.getByRole("banner")).toHaveTextContent("ReleaseMesh");
    expect(screen.getByRole("navigation")).toHaveTextContent("Release Centre");
  });

  it("contains a failing Catalog render while Release remains usable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadCatalogRemote = vi.fn().mockResolvedValue({
      ...catalogRemote,
      CatalogApp: () => {
        throw new Error("remote render failed");
      }
    });
    const loadReleaseRemote = vi.fn().mockResolvedValue(releaseRemote);

    render(<App loadCatalogRemote={loadCatalogRemote} loadReleaseRemote={loadReleaseRemote} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog remote failed to render");
    expect(await screen.findByRole("heading", {
      name: "Federated Release Centre via https://api.example/"
    })).toBeInTheDocument();
  });
});
