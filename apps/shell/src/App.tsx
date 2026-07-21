import { Component, useEffect, useState, type ReactNode } from "react";

import {
  loadReleaseRemote as loadRuntimeReleaseRemote,
  type ReleaseRemoteModule
} from "./runtime-remotes.js";
import "./styles.css";

export interface AppProps {
  loadReleaseRemote?: () => Promise<ReleaseRemoteModule>;
}

type RemoteState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { remote: ReleaseRemoteModule; status: "ready" };

export function App({ loadReleaseRemote = loadRuntimeReleaseRemote }: AppProps): React.JSX.Element {
  const [remoteState, setRemoteState] = useState<RemoteState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadReleaseRemote().then(
      (remote) => {
        if (active) setRemoteState({ remote, status: "ready" });
      },
      (error: unknown) => {
        if (active) {
          setRemoteState({
            message: error instanceof Error ? error.message : "Unknown remote loading failure",
            status: "error"
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [loadReleaseRemote]);

  return (
    <div className="shell-layout">
      <header className="shell-header" role="banner">
        <div>
          <p className="shell-eyebrow">Release assurance control plane</p>
          <h1>ReleaseMesh</h1>
        </div>
        {remoteState.status === "ready" ? (
          <span className="remote-version">Release remote {remoteState.remote.releaseMfeVersion}</span>
        ) : null}
      </header>
      <nav aria-label="Primary navigation">
        <a aria-current="page" href="#release">Release Centre</a>
      </nav>
      <section aria-label="Release remote" className="remote-slot" id="release">
        {remoteState.status === "loading" ? <p role="status">Loading Release remote…</p> : null}
        {remoteState.status === "error" ? (
          <div role="alert">
            <h2>Release remote unavailable</h2>
            <p>{remoteState.message}</p>
          </div>
        ) : null}
        {remoteState.status === "ready" ? (
          <RemoteErrorBoundary>
            <remoteState.remote.ReleaseApp />
          </RemoteErrorBoundary>
        ) : null}
      </section>
    </div>
  );
}

class RemoteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  public state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert">
          <h2>Release remote failed to render</h2>
          <p>The Shell remains available. Reload after the remote is healthy.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
