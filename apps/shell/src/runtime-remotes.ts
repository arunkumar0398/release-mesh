import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import type { ComponentType } from "react";

export interface CatalogRemoteModule {
  CatalogApp: ComponentType<{ apiBaseUrl?: string }>;
  apiBaseUrl: string;
  catalogMfeVersion: string;
}

export interface ReleaseRemoteModule {
  ReleaseApp: ComponentType<{ apiBaseUrl?: string }>;
  apiBaseUrl: string;
  releaseMfeVersion: string;
}

export interface FederationRuntime {
  loadRemote(moduleId: string): Promise<unknown>;
  registerRemotes(remotes: Array<{ entry: string; name: string }>): Promise<void> | void;
}

export interface LoadRemoteOptions {
  configUrl?: string;
  fetchImpl?: typeof fetch;
  runtime?: FederationRuntime;
}

export type LoadReleaseRemoteOptions = LoadRemoteOptions;

const defaultRuntime: FederationRuntime = {
  loadRemote: (moduleId) => loadRemote(moduleId),
  registerRemotes: (remotes) => registerRemotes(remotes)
};

export async function loadCatalogRemote(
  options: LoadRemoteOptions = {}
): Promise<CatalogRemoteModule> {
  const { apiBaseUrl, remote } = await loadConfiguredRemote(
    "catalog",
    "Catalog",
    "catalog_mfe",
    "catalog_mfe/CatalogApp",
    options
  );
  if (!isCatalogRemoteModule(remote)) throw new Error("Catalog remote module is invalid");
  return { ...remote, apiBaseUrl };
}

export async function loadReleaseRemote(
  options: LoadReleaseRemoteOptions = {}
): Promise<ReleaseRemoteModule> {
  const { apiBaseUrl, remote } = await loadConfiguredRemote(
    "release",
    "Release",
    "release_mfe",
    "release_mfe/ReleaseApp",
    options
  );
  if (!isReleaseRemoteModule(remote)) throw new Error("Release remote module is invalid");
  return { ...remote, apiBaseUrl };
}

async function loadConfiguredRemote(
  configKey: "catalog" | "release",
  label: "Catalog" | "Release",
  remoteName: string,
  moduleId: string,
  {
    configUrl = "/remotes.json",
    fetchImpl = fetch,
    runtime = defaultRuntime
  }: LoadRemoteOptions
): Promise<{ apiBaseUrl: string; remote: unknown }> {
  const response = await fetchImpl(configUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label} remote configuration is unavailable`);
  const config = await response.json() as unknown;
  const { apiBaseUrl, manifestUrl } = readRemoteConfig(config, configKey, label);

  await runtime.registerRemotes([{ entry: manifestUrl, name: remoteName }]);
  const remote = await runtime.loadRemote(moduleId);
  return { apiBaseUrl, remote };
}

function readRemoteConfig(
  config: unknown,
  configKey: "catalog" | "release",
  label: "Catalog" | "Release"
): { apiBaseUrl: string; manifestUrl: string } {
  if (typeof config !== "object" || config === null || !(configKey in config)) {
    throw new Error(`${label} remote configuration is missing`);
  }
  const candidate = (config as Record<string, unknown>)[configKey];
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error(`${label} remote configuration is missing`);
  }
  const remote = candidate as Record<string, unknown>;
  if (typeof remote.manifestUrl !== "string" || typeof remote.apiBaseUrl !== "string") {
    throw new Error(`${label} remote configuration is missing`);
  }

  return {
    apiBaseUrl: readHttpUrl(remote.apiBaseUrl, "Control-plane API"),
    manifestUrl: readHttpUrl(remote.manifestUrl, `${label} manifest`)
  };
}

function readHttpUrl(value: string, label: string): string {
  const parsed = new URL(value, globalThis.location?.href ?? "http://127.0.0.1");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} URL must use HTTP or HTTPS`);
  }
  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || value.includes("?")
    || value.includes("#")
  ) {
    throw new Error(`${label} URL must not include credentials, a query, or a fragment`);
  }
  return parsed.href;
}

function isCatalogRemoteModule(value: unknown): value is Omit<CatalogRemoteModule, "apiBaseUrl"> {
  return typeof value === "object"
    && value !== null
    && "CatalogApp" in value
    && typeof (value as { CatalogApp?: unknown }).CatalogApp === "function"
    && "catalogMfeVersion" in value
    && typeof (value as { catalogMfeVersion?: unknown }).catalogMfeVersion === "string";
}

function isReleaseRemoteModule(value: unknown): value is Omit<ReleaseRemoteModule, "apiBaseUrl"> {
  return typeof value === "object"
    && value !== null
    && "ReleaseApp" in value
    && typeof (value as { ReleaseApp?: unknown }).ReleaseApp === "function"
    && "releaseMfeVersion" in value
    && typeof (value as { releaseMfeVersion?: unknown }).releaseMfeVersion === "string";
}
