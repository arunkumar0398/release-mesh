import { useEffect, useMemo, useRef, useState } from "react";

import {
  createReleaseApiClient,
  type PricingCandidate,
  type ReleaseAppClient,
  type ReleaseArtifact,
  type ReleaseDetails,
  type ReleaseSummary
} from "./api.js";
import "./styles.css";

export const releaseMfeVersion = "0.1.0";

export interface ReleaseAppProps {
  apiBaseUrl?: string;
  client?: ReleaseAppClient;
  pollIntervalMs?: number;
}

type ReleaseState =
  | { status: "idle" }
  | { candidateVersion: PricingCandidate; status: "submitting" }
  | {
      artifacts: ReleaseArtifact[];
      details: ReleaseDetails | null;
      release: ReleaseSummary;
      status: "active";
    }
  | { message: string; status: "error" };

const terminalStatuses = new Set(["BLOCKED", "ERROR", "SAFE"]);

export function ReleaseApp({
  apiBaseUrl = "/api",
  client,
  pollIntervalMs = 500
}: ReleaseAppProps): React.JSX.Element {
  const api = useMemo(() => client ?? createReleaseApiClient(apiBaseUrl), [apiBaseUrl, client]);
  const requestGeneration = useRef(0);
  const [state, setState] = useState<ReleaseState>({ status: "idle" });

  useEffect(() => () => {
    requestGeneration.current += 1;
  }, []);

  async function createRelease(candidateVersion: PricingCandidate): Promise<void> {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setState({ candidateVersion, status: "submitting" });

    try {
      const idempotencyKey = createIdempotencyKey(candidateVersion);
      const release = await api.createRelease(candidateVersion, idempotencyKey);
      if (requestGeneration.current !== generation) return;
      setState({ artifacts: [], details: null, release, status: "active" });
      await pollRelease(api, release, generation, requestGeneration, pollIntervalMs, setState);
    } catch (error) {
      if (requestGeneration.current === generation) {
        setState({
          message: error instanceof Error ? error.message : "Release request failed",
          status: "error"
        });
      }
    }
  }

  const activeRelease = state.status === "active" ? state.details ?? state.release : null;
  const isBusy = state.status === "submitting"
    || (state.status === "active" && !terminalStatuses.has(activeRelease?.status ?? ""));

  return (
    <main className="release-app">
      <header className="release-hero">
        <p className="eyebrow">Release Centre</p>
        <h1>Pricing release assurance</h1>
        <p>Run the trusted Checkout/Pricing checks and inspect the persisted deterministic evidence.</p>
      </header>

      <section aria-label="Create Pricing release" className="candidate-actions">
        <h2>Create a fixed candidate</h2>
        <div className="button-row">
          <button disabled={isBusy} onClick={() => void createRelease("v2")} type="button">
            Validate Pricing v2
          </button>
          <button disabled={isBusy} onClick={() => void createRelease("v2.1")} type="button">
            Validate Pricing v2.1
          </button>
        </div>
      </section>

      {state.status === "submitting" ? (
        <p aria-live="polite" role="status">Creating Pricing {state.candidateVersion} release…</p>
      ) : null}
      {state.status === "error" ? <p role="alert">{state.message}</p> : null}

      {state.status === "active" ? (
        <ReleaseInspection
          artifacts={state.artifacts}
          details={state.details}
          release={state.release}
        />
      ) : null}
    </main>
  );
}

function ReleaseInspection({
  artifacts,
  details,
  release
}: {
  artifacts: ReleaseArtifact[];
  details: ReleaseDetails | null;
  release: ReleaseSummary;
}): React.JSX.Element {
  const current = details ?? release;
  const terminal = terminalStatuses.has(current.status);

  return (
    <section aria-label="Release inspection" className="release-inspection">
      <div className="release-summary">
        <div>
          <span>Candidate</span>
          <strong>Pricing {current.candidateVersion}</strong>
        </div>
        <div>
          <span>Release ID</span>
          <code>{current.id}</code>
        </div>
        <div>
          <span>Attempt</span>
          <strong>{current.attempt}</strong>
        </div>
      </div>

      {terminal ? (
        <p aria-label="Deterministic release gate" className={`gate gate-${current.status.toLowerCase()}`} role="status">
          Deterministic gate: <strong>{current.status}</strong>
        </p>
      ) : (
        <p aria-live="polite" role="status">Release status: {current.status}</p>
      )}

      {details ? <Lifecycle transitions={details.transitions} /> : null}
      {details ? <TestRuns testRuns={details.testRuns} /> : null}
      {terminal ? <Evidence artifacts={artifacts} /> : null}
    </section>
  );
}

function Lifecycle({ transitions }: { transitions: ReleaseDetails["transitions"] }): React.JSX.Element {
  return (
    <section aria-label="Release lifecycle">
      <h2>Lifecycle</h2>
      <ol>
        {transitions.map((transition) => (
          <li key={transition.id}>
            <strong>{transition.toStatus}</strong>
            <span>{` · attempt ${transition.attempt}`}</span>
            {transition.errorCode ? <span>{` · ${transition.errorCode}`}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TestRuns({ testRuns }: { testRuns: ReleaseDetails["testRuns"] }): React.JSX.Element {
  return (
    <section aria-label="Mandatory test runs">
      <h2>Mandatory test runs</h2>
      {testRuns.length === 0 ? <p>Waiting for trusted checks…</p> : (
        <ul>
          {testRuns.map((testRun) => (
            <li key={testRun.id}>
              <strong>{testRun.testId}</strong>
              <span>{testRun.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Evidence({ artifacts }: { artifacts: ReleaseArtifact[] }): React.JSX.Element {
  return (
    <section aria-label="Release evidence">
      <h2>Evidence</h2>
      {artifacts.length === 0 ? <p>No persisted evidence was returned.</p> : (
        <div className="evidence-grid">
          {artifacts.map((artifact) => (
            <article key={artifact.id}>
              <h3>{artifact.kind}</h3>
              <p>{`${artifact.contentType} · ${artifact.sizeBytes} bytes`}</p>
              {artifact.jsonContent !== null ? <pre>{JSON.stringify(artifact.jsonContent, null, 2)}</pre> : null}
              {artifact.textContent !== null ? <pre>{artifact.textContent}</pre> : null}
              {artifact.binaryContent !== null && artifact.contentType.startsWith("image/") ? (
                <img
                  alt={`${artifact.kind} evidence`}
                  src={`data:${artifact.contentType};base64,${artifact.binaryContent}`}
                />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

async function pollRelease(
  client: ReleaseAppClient,
  release: ReleaseSummary,
  generation: number,
  generationRef: React.MutableRefObject<number>,
  pollIntervalMs: number,
  setState: React.Dispatch<React.SetStateAction<ReleaseState>>
): Promise<void> {
  while (generationRef.current === generation) {
    const details = await client.getRelease(release.id);
    if (generationRef.current !== generation) return;
    setState({ artifacts: [], details, release, status: "active" });
    if (terminalStatuses.has(details.status)) {
      const artifacts = await client.listArtifacts(release.id);
      if (generationRef.current === generation) {
        setState({ artifacts, details, release, status: "active" });
      }
      return;
    }
    await delay(pollIntervalMs);
  }
}

function createIdempotencyKey(candidateVersion: PricingCandidate): string {
  const normalizedVersion = candidateVersion.replace(".", "-");
  return `release-${normalizedVersion}-${Date.now()}-${crypto.randomUUID()}`;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
