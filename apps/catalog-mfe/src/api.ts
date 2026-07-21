export interface CatalogComponentVersion {
  id: string;
  version: string;
}

export interface CatalogContract {
  endpoint: string;
  id: string;
  schema: unknown;
  version: string;
}

export interface CatalogComponent {
  id: string;
  kind: string;
  name: "checkout" | "pricing";
  ownerTeam: string;
  providedContracts: CatalogContract[];
  versions: CatalogComponentVersion[];
}

export interface CatalogDependency {
  consumer: { id: string; name: "checkout" };
  expectedContractVersion: string;
  id: string;
  owningTeam: string;
  provider: { id: string; name: "pricing" };
  requiredEndpoints: string[];
}

export interface CatalogSnapshot {
  components: CatalogComponent[];
  dependencies: CatalogDependency[];
}

const seededComponentNames = new Set(["checkout", "pricing"]);

export async function loadCatalog(
  apiBaseUrl = "/api",
  fetchImpl: typeof fetch = fetch
): Promise<CatalogSnapshot> {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const [componentPayload, dependencyPayload] = await Promise.all([
    fetchJson(`${baseUrl}/components`, fetchImpl),
    fetchJson(`${baseUrl}/dependencies`, fetchImpl)
  ]);
  const summaries = readComponentSummaries(componentPayload)
    .filter(({ name }) => seededComponentNames.has(name));
  const components = await Promise.all(summaries.map(async ({ id }) => (
    readComponent(await fetchJson(`${baseUrl}/components/${encodeURIComponent(id)}`, fetchImpl))
  )));
  const dependencies = readDependencies(dependencyPayload).filter((dependency) => (
    dependency.consumer.name === "checkout" && dependency.provider.name === "pricing"
  ));

  return {
    components: components.sort((left, right) => left.name.localeCompare(right.name)),
    dependencies
  };
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Catalogue request failed with ${response.status}`);
  return response.json() as Promise<unknown>;
}

function readComponentSummaries(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) throw new Error("Catalogue components response is invalid");
  return value.map((entry) => {
    const record = readRecord(entry, "Catalogue components response is invalid");
    return {
      id: readString(record.id, "Catalogue components response is invalid"),
      name: readString(record.name, "Catalogue components response is invalid")
    };
  });
}

function readComponent(value: unknown): CatalogComponent {
  const record = readRecord(value, "Catalogue component response is invalid");
  const name = readString(record.name, "Catalogue component response is invalid");
  if (name !== "checkout" && name !== "pricing") {
    throw new Error("Catalogue component response contains an unseeded component");
  }
  if (!Array.isArray(record.versions) || !Array.isArray(record.providedContracts)) {
    throw new Error("Catalogue component response is invalid");
  }

  return {
    id: readString(record.id, "Catalogue component response is invalid"),
    kind: readString(record.kind, "Catalogue component response is invalid"),
    name,
    ownerTeam: readString(record.ownerTeam, "Catalogue component response is invalid"),
    providedContracts: record.providedContracts.map((entry) => {
      const contract = readRecord(entry, "Catalogue component response is invalid");
      return {
        endpoint: readString(contract.endpoint, "Catalogue component response is invalid"),
        id: readString(contract.id, "Catalogue component response is invalid"),
        schema: contract.schema,
        version: readString(contract.version, "Catalogue component response is invalid")
      };
    }),
    versions: record.versions.map((entry) => {
      const version = readRecord(entry, "Catalogue component response is invalid");
      return {
        id: readString(version.id, "Catalogue component response is invalid"),
        version: readString(version.version, "Catalogue component response is invalid")
      };
    })
  };
}

function readDependencies(value: unknown): CatalogDependency[] {
  if (!Array.isArray(value)) throw new Error("Catalogue dependencies response is invalid");
  return value.flatMap((entry) => {
    const dependency = readRecord(entry, "Catalogue dependencies response is invalid");
    const consumer = readRecord(dependency.consumer, "Catalogue dependencies response is invalid");
    const provider = readRecord(dependency.provider, "Catalogue dependencies response is invalid");
    const consumerName = readString(consumer.name, "Catalogue dependencies response is invalid");
    const providerName = readString(provider.name, "Catalogue dependencies response is invalid");
    if (consumerName !== "checkout" || providerName !== "pricing") return [];
    if (!Array.isArray(dependency.requiredEndpoints)) {
      throw new Error("Catalogue dependencies response is invalid");
    }
    return [{
      consumer: {
        id: readString(consumer.id, "Catalogue dependencies response is invalid"),
        name: consumerName
      },
      expectedContractVersion: readString(
        dependency.expectedContractVersion,
        "Catalogue dependencies response is invalid"
      ),
      id: readString(dependency.id, "Catalogue dependencies response is invalid"),
      owningTeam: readString(dependency.owningTeam, "Catalogue dependencies response is invalid"),
      provider: {
        id: readString(provider.id, "Catalogue dependencies response is invalid"),
        name: providerName
      },
      requiredEndpoints: dependency.requiredEndpoints.map((endpoint) => (
        readString(endpoint, "Catalogue dependencies response is invalid")
      ))
    }];
  });
}

function readRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function readString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}
