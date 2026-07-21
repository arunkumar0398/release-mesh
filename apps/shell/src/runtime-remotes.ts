import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import type { ComponentType } from "react";

export interface ReleaseRemoteModule {
  ReleaseApp: ComponentType<{ apiBaseUrl?: string }>;
  apiBaseUrl: string;
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
  const { apiBaseUrl, manifestUrl } = readReleaseConfig(config);

  await runtime.registerRemotes([{ entry: manifestUrl, name: "release_mfe" }]);
  const remote = await runtime.loadRemote("release_mfe/ReleaseApp");
  if (!isReleaseRemoteModule(remote)) {
    throw new Error("Release remote module is invalid");
  }
  return { ...remote, apiBaseUrl };
}

function readReleaseConfig(config: unknown): { apiBaseUrl: string; manifestUrl: string } {
  if (
    typeof config !== "object"
    || config === null
    || !("release" in config)
    || typeof (config as { release?: unknown }).release !== "object"
    || (config as { release?: unknown }).release === null
    || !("manifestUrl" in (config as { release: object }).release)
    || !("apiBaseUrl" in (config as { release: object }).release)
    || typeof (config as { release: { manifestUrl?: unknown } }).release.manifestUrl !== "string"
    || typeof (config as { release: { apiBaseUrl?: unknown } }).release.apiBaseUrl !== "string"
  ) {
    throw new Error("Release remote configuration is missing");
  }

  const release = (config as { release: { apiBaseUrl: string; manifestUrl: string } }).release;
  const manifestUrl = release.manifestUrl;
  const parsed = new URL(manifestUrl, globalThis.location?.href ?? "http://127.0.0.1");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Release manifest URL must use HTTP or HTTPS");
  }
  const apiBaseUrl = new URL(release.apiBaseUrl, globalThis.location?.href ?? "http://127.0.0.1");
  if (apiBaseUrl.protocol !== "http:" && apiBaseUrl.protocol !== "https:") {
    throw new Error("Control-plane API URL must use HTTP or HTTPS");
  }
  if (
    apiBaseUrl.username
    || apiBaseUrl.password
    || apiBaseUrl.search
    || apiBaseUrl.hash
    || release.apiBaseUrl.includes("?")
    || release.apiBaseUrl.includes("#")
  ) {
    throw new Error("Control-plane API URL must not include credentials, a query, or a fragment");
  }
  return { apiBaseUrl: apiBaseUrl.href, manifestUrl: parsed.href };
}

function isReleaseRemoteModule(value: unknown): value is Omit<ReleaseRemoteModule, "apiBaseUrl"> {
  return typeof value === "object"
    && value !== null
    && "ReleaseApp" in value
    && typeof (value as { ReleaseApp?: unknown }).ReleaseApp === "function"
    && "releaseMfeVersion" in value
    && typeof (value as { releaseMfeVersion?: unknown }).releaseMfeVersion === "string";
}
