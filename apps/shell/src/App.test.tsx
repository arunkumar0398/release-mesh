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
  it("loads Release at runtime and displays its loaded version", async () => {
    const loadReleaseRemote = vi.fn().mockResolvedValue({
      ReleaseApp: () => <h2>Federated Release Centre</h2>,
      releaseMfeVersion: "0.1.0"
    });

    render(<App loadReleaseRemote={loadReleaseRemote} />);

    expect(screen.getByRole("banner")).toHaveTextContent("ReleaseMesh");
    expect(await screen.findByRole("heading", { name: "Federated Release Centre" })).toBeInTheDocument();
    expect(screen.getByText("Release remote 0.1.0")).toBeInTheDocument();
    expect(loadReleaseRemote).toHaveBeenCalledOnce();
  });

  it("keeps the Shell usable when the Release manifest is unavailable", async () => {
    const loadReleaseRemote = vi.fn().mockRejectedValue(new Error("manifest unavailable"));

    render(<App loadReleaseRemote={loadReleaseRemote} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Release remote unavailable");
    expect(screen.getByRole("banner")).toHaveTextContent("ReleaseMesh");
    expect(screen.getByRole("navigation")).toHaveTextContent("Release Centre");
  });

  it("contains a failing remote render inside its error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadReleaseRemote = vi.fn().mockResolvedValue({
      ReleaseApp: () => {
        throw new Error("remote render failed");
      },
      releaseMfeVersion: "0.1.0"
    });

    render(<App loadReleaseRemote={loadReleaseRemote} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Release remote failed to render");
    expect(screen.getByRole("banner")).toHaveTextContent("ReleaseMesh");
  });
});
