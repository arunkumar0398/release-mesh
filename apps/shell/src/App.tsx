import { useEffect, useState } from "react";

import { RemoteBoundary } from "./RemoteBoundary.js";
import {
  loadCatalogRemote as loadRuntimeCatalogRemote,
  loadReleaseRemote as loadRuntimeReleaseRemote,
  type CatalogRemoteModule,
  type ReleaseRemoteModule
} from "./runtime-remotes.js";
import "./styles.css";

export interface AppProps {
  loadCatalogRemote?: () => Promise<CatalogRemoteModule>;
  loadReleaseRemote?: () => Promise<ReleaseRemoteModule>;
}

type RemoteState<RemoteModule> =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { remote: RemoteModule; status: "ready" };

export function App({
  loadCatalogRemote = loadRuntimeCatalogRemote,
  loadReleaseRemote = loadRuntimeReleaseRemote
}: AppProps): React.JSX.Element {
  const catalogState = useRemote(loadCatalogRemote);
  const releaseState = useRemote(loadReleaseRemote);

  return (
    <div className="shell-layout">
      <header className="shell-header" role="banner">
        <div>
          <p className="shell-eyebrow">Release assurance control plane</p>
          <h1>ReleaseMesh</h1>
        </div>
        <div aria-label="Loaded remote versions" className="remote-versions">
          {catalogState.status === "ready" ? (
            <span className="remote-version">Catalog remote {catalogState.remote.catalogMfeVersion}</span>
          ) : null}
          {releaseState.status === "ready" ? (
            <span className="remote-version">Release remote {releaseState.remote.releaseMfeVersion}</span>
          ) : null}
        </div>
      </header>
      <nav aria-label="Primary navigation">
        <a href="#catalog">Service Catalogue</a>
        <a href="#release">Release Centre</a>
      </nav>
      <RemoteSlot label="Catalog" state={catalogState}>
        {catalogState.status === "ready" ? (
          <RemoteBoundary remoteName="Catalog">
            <catalogState.remote.CatalogApp apiBaseUrl={catalogState.remote.apiBaseUrl} />
          </RemoteBoundary>
        ) : null}
      </RemoteSlot>
      <RemoteSlot label="Release" state={releaseState}>
        {releaseState.status === "ready" ? (
          <RemoteBoundary remoteName="Release">
            <releaseState.remote.ReleaseApp apiBaseUrl={releaseState.remote.apiBaseUrl} />
          </RemoteBoundary>
        ) : null}
      </RemoteSlot>
    </div>
  );
}

function useRemote<RemoteModule>(
  loadRemote: () => Promise<RemoteModule>
): RemoteState<RemoteModule> {
  const [state, setState] = useState<RemoteState<RemoteModule>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void loadRemote().then(
      (remote) => {
        if (active) setState({ remote, status: "ready" });
      },
      (error: unknown) => {
        if (active) {
          setState({
            message: error instanceof Error ? error.message : "Unknown remote loading failure",
            status: "error"
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [loadRemote]);

  return state;
}

function RemoteSlot<RemoteModule>({
  children,
  label,
  state
}: {
  children: React.ReactNode;
  label: "Catalog" | "Release";
  state: RemoteState<RemoteModule>;
}): React.JSX.Element {
  return (
    <section
      aria-label={`${label} remote`}
      className="remote-slot"
      id={label.toLowerCase()}
    >
      {state.status === "loading" ? <p role="status">Loading {label} remote…</p> : null}
      {state.status === "error" ? (
        <div role="alert">
          <h2>{label} remote unavailable</h2>
          <p>{state.message}</p>
        </div>
      ) : null}
      {children}
    </section>
  );
}
