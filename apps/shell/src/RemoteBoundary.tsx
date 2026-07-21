import { Component, type ReactNode } from "react";

export interface RemoteBoundaryProps {
  children: ReactNode;
  remoteName: string;
}

export class RemoteBoundary extends Component<RemoteBoundaryProps, { failed: boolean }> {
  public state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert">
          <h2>{this.props.remoteName} remote failed to render</h2>
          <p>The Shell and other remotes remain available. Reload after this remote is healthy.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
