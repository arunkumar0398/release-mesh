import { useEffect, useState } from "react";

import { loadCatalog, type CatalogSnapshot } from "./api.js";
import "./styles.css";

export const catalogMfeVersion = "0.1.0";

export interface CatalogAppProps {
  apiBaseUrl?: string;
  loadSnapshot?: (apiBaseUrl?: string) => Promise<CatalogSnapshot>;
}

type CatalogState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { snapshot: CatalogSnapshot; status: "ready" };

export function CatalogApp({
  apiBaseUrl = "/api",
  loadSnapshot = loadCatalog
}: CatalogAppProps): React.JSX.Element {
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadSnapshot(apiBaseUrl).then(
      (snapshot) => {
        if (active) setState({ snapshot, status: "ready" });
      },
      (error: unknown) => {
        if (active) {
          setState({
            message: error instanceof Error ? error.message : "Unknown catalogue failure",
            status: "error"
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [apiBaseUrl, loadSnapshot]);

  if (state.status === "loading") return <p role="status">Loading service catalogue...</p>;
  if (state.status === "error") {
    return (
      <div className="catalog-alert" role="alert">
        <h2>Catalogue data unavailable</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <main className="catalog-app">
      <header className="catalog-hero">
        <div>
          <p className="catalog-eyebrow">Trusted dependency inventory</p>
          <h2>Service Catalogue</h2>
          <p>Only the seeded Checkout consumer and Pricing provider are in Build Week scope.</p>
        </div>
        <span className="catalog-count">{state.snapshot.components.length} components</span>
      </header>

      <section aria-labelledby="catalog-components-heading" className="catalog-section">
        <h3 id="catalog-components-heading">Components</h3>
        <div className="component-grid">
          {state.snapshot.components.map((component) => (
            <article className="component-card" key={component.id}>
              <div className="component-heading">
                <div>
                  <p className="component-kind">{component.kind}</p>
                  <h4>{titleCase(component.name)}</h4>
                </div>
                <span className="owner-team">{component.ownerTeam}</span>
              </div>

              <div className="catalog-detail">
                <strong>Versions</strong>
                {component.versions.length === 0 ? (
                  <span className="muted">Consumer contract only</span>
                ) : (
                  <div className="version-list">
                    {component.versions.map((version) => (
                      <span className="version-chip" key={version.id}>{version.version}</span>
                    ))}
                  </div>
                )}
              </div>

              {component.providedContracts.map((contract) => (
                <div className="contract-card" key={contract.id}>
                  <strong>Provided contract {contract.version}</strong>
                  <code>{contract.endpoint}</code>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="catalog-dependencies-heading" className="catalog-section">
        <h3 id="catalog-dependencies-heading">Registered Dependency</h3>
        {state.snapshot.dependencies.map((dependency) => (
          <article className="dependency-card" key={dependency.id}>
            <div>
              <p className="dependency-route">Checkout → Pricing</p>
              <p>Owned by <strong>{dependency.owningTeam}</strong></p>
            </div>
            <dl>
              <div>
                <dt>Expected contract</dt>
                <dd>{dependency.expectedContractVersion}</dd>
              </div>
              <div>
                <dt>Required endpoint</dt>
                <dd>
                  {dependency.requiredEndpoints.map((endpoint) => (
                    <code key={endpoint}>{endpoint}</code>
                  ))}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </main>
  );
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
