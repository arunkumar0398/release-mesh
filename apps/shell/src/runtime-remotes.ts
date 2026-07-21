import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import type { ComponentType } from "react";

export interface ReleaseRemoteModule {
  ReleaseApp: ComponentType;
  releaseMfeVersion: string;
}

export interface FederationRuntime {
  loadRemote(moduleId: string): Promise<unknown>;
  registerRemotes(remotes: Array<{ entry: string; name: string }>): Promise<void> | void;
}

export interface LoadReleaseRemoteOptions {
  configUrl?: string;
  fetchImpl?: typeof fetch;
  runtime?: FederationRuntime;
}

const defaultRuntime: FederationRuntime = {
  loadRemote: (moduleId) => loadRemote(moduleId),
  registerRemotes: (remotes) => registerRemotes(remotes)
};

export async function loadReleaseRemote({
  configUrl = "/remotes.json",
  fetchImpl = fetch,
  runtime = defaultRuntime
}: LoadReleaseRemoteOptions = {}): Promise<ReleaseRemoteModule> {
  const response = await fetchImpl(configUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Release remote configuration is unavailable");
  const config = await response.json() as unknown;
  const manifestUrl = readManifestUrl(config);

  await runtime.registerRemotes([{ entry: manifestUrl, name: "release_mfe" }]);
  const remote = await runtime.loadRemote("release_mfe/ReleaseApp");
  if (!isReleaseRemoteModule(remote)) {
    throw new Error("Release remote module is invalid");
  }
  return remote;
}

function readManifestUrl(config: unknown): string {
  if (
    typeof config !== "object"
    || config === null
    || !("release" in config)
    || typeof (config as { release?: unknown }).release !== "object"
    || (config as { release?: unknown }).release === null
    || !("manifestUrl" in (config as { release: object }).release)
    || typeof (config as { release: { manifestUrl?: unknown } }).release.manifestUrl !== "string"
  ) {
    throw new Error("Release remote configuration is missing");
  }

  const manifestUrl = (config as { release: { manifestUrl: string } }).release.manifestUrl;
  const parsed = new URL(manifestUrl, globalThis.location?.href ?? "http://127.0.0.1");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Release manifest URL must use HTTP or HTTPS");
  }
  return parsed.href;
}

function isReleaseRemoteModule(value: unknown): value is ReleaseRemoteModule {
  return typeof value === "object"
    && value !== null
    && "ReleaseApp" in value
    && typeof (value as { ReleaseApp?: unknown }).ReleaseApp === "function"
    && "releaseMfeVersion" in value
    && typeof (value as { releaseMfeVersion?: unknown }).releaseMfeVersion === "string";
}
