import { useEffect, useMemo, useRef, useState } from "react";

import {
  createReleaseApiClient,
  type PricingCandidate,
  type ReleaseAppClient,
  type ReleaseArtifact,
  ReleaseApiError,
  type ReleaseDetails,
  type ReleaseSummary
} from "./api.js";
import {
  clearPendingSubmissionKey,
  createReleaseIdempotencyKey,
  readPendingSubmissionKey,
  writePendingSubmissionKey
} from "./idempotency.js";
import "./styles.css";

export const releaseMfeVersion = "0.1.0";

export interface ReleaseAppProps {
  apiBaseUrl?: string;
  client?: ReleaseAppClient;
  maxPollIntervalMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface ActiveReleaseState {
  artifacts: ReleaseArtifact[];
  details: ReleaseDetails | null;
  evidenceError: string | null;
  evidenceLoading: boolean;
  pollError: string | null;
  polling: boolean;
  release: ReleaseSummary;
  retryError: string | null;
  retrying: boolean;
  status: "active";
}

type ReleaseState =
  | { status: "idle" }
  | { candidateVersion: PricingCandidate; status: "submitting" }
  | ActiveReleaseState
  | { message: string; status: "error" };

const terminalStatuses = new Set(["BLOCKED", "ERROR", "SAFE"]);

export function ReleaseApp({
  apiBaseUrl = "/api",
  client,
  maxPollIntervalMs = 4_000,
  pollIntervalMs = 500,
  pollTimeoutMs = 30_000
}: ReleaseAppProps): React.JSX.Element {
  const api = useMemo(() => client ?? createReleaseApiClient(apiBaseUrl), [apiBaseUrl, client]);
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const pendingSubmissions = useRef(new Map<PricingCandidate, string>());
  const [state, setState] = useState<ReleaseState>({ status: "idle" });

  useEffect(() => () => {
    requestGeneration.current += 1;
    requestController.current?.abort();
  }, []);

  function beginRequest(): { controller: AbortController; generation: number } {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    return { controller, generation };
  }

  async function createRelease(candidateVersion: PricingCandidate): Promise<void> {
    const { controller, generation } = beginRequest();
    const idempotencyKey = pendingSubmissions.current.get(candidateVersion)
      ?? readPendingSubmissionKey(candidateVersion)
      ?? createReleaseIdempotencyKey(candidateVersion);
    pendingSubmissions.current.set(candidateVersion, idempotencyKey);
    writePendingSubmissionKey(candidateVersion, idempotencyKey);
    setState({ candidateVersion, status: "submitting" });

    try {
      const release = await api.createRelease(candidateVersion, idempotencyKey, controller.signal);
      if (requestGeneration.current !== generation) return;
      pendingSubmissions.current.delete(candidateVersion);
      clearPendingSubmissionKey(candidateVersion);
      setState(createActiveState(release));
      await pollRelease({
        client: api,
        controller,
        generation,
        generationRef: requestGeneration,
        maxPollIntervalMs,
        pollIntervalMs,
        pollTimeoutMs,
        release,
        setState
      });
    } catch (error) {
      if (requestGeneration.current === generation && !isAbortError(error)) {
        if (!isUncertainSubmissionError(error)) {
          pendingSubmissions.current.delete(candidateVersion);
          clearPendingSubmissionKey(candidateVersion);
        }
        setState({
          message: error instanceof Error ? error.message : "Release request failed",
          status: "error"
        });
      }
    }
  }

  async function resumeStatusChecks(release: ReleaseSummary): Promise<void> {
    const { controller, generation } = beginRequest();
    updateActiveState(setState, release.id, (active) => ({
      ...active,
      pollError: null,
      polling: true
    }));
    await pollRelease({
      client: api,
      controller,
      generation,
      generationRef: requestGeneration,
      maxPollIntervalMs,
      pollIntervalMs,
      pollTimeoutMs,
      release,
      setState
    });
  }

  async function retryEvidence(release: ReleaseSummary): Promise<void> {
    const { controller, generation } = beginRequest();
    await loadArtifacts(api, release, controller, generation, requestGeneration, setState);
  }

  async function retryRelease(release: ReleaseSummary): Promise<void> {
    const { controller, generation } = beginRequest();
    updateActiveState(setState, release.id, (active) => ({
      ...active,
      retryError: null,
      retrying: true
    }));
    try {
      const retriedRelease = await api.retryRelease(release.id, controller.signal);
      if (requestGeneration.current !== generation) return;
      setState(createActiveState(retriedRelease));
      await pollRelease({
        client: api,
        controller,
        generation,
        generationRef: requestGeneration,
        maxPollIntervalMs,
        pollIntervalMs,
        pollTimeoutMs,
        release: retriedRelease,
        setState
      });
    } catch (error) {
      if (requestGeneration.current === generation && !isAbortError(error)) {
        const retryError = error instanceof Error ? error.message : "Release retry failed";
        try {
          const reconciledRelease = await api.getRelease(release.id, controller.signal);
          if (requestGeneration.current !== generation) return;
          if (reconciledRelease.status !== "ERROR") {
            setState(createActiveState(reconciledRelease));
            await pollRelease({
              client: api,
              controller,
              generation,
              generationRef: requestGeneration,
              maxPollIntervalMs,
              pollIntervalMs,
              pollTimeoutMs,
              release: reconciledRelease,
              setState
            });
            return;
          }
          setState({
            ...createActiveState(reconciledRelease),
            details: reconciledRelease,
            polling: false,
            retryError
          });
        } catch (reconciliationError) {
          if (requestGeneration.current === generation && !isAbortError(reconciliationError)) {
            updateActiveState(setState, release.id, (active) => ({
              ...active,
              retryError,
              retrying: false
            }));
          }
        }
      }
    }
  }

  const isBusy = state.status === "submitting"
    || (state.status === "active" && (state.polling || state.retrying));

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
          state={state}
          onResumeStatus={() => void resumeStatusChecks(state.release)}
          onRetryEvidence={() => void retryEvidence(state.release)}
          onRetryRelease={() => void retryRelease(state.release)}
        />
      ) : null}
    </main>
  );
}

function ReleaseInspection({
  onResumeStatus,
  onRetryEvidence,
  onRetryRelease,
  state
}: {
  onResumeStatus: () => void;
  onRetryEvidence: () => void;
  onRetryRelease: () => void;
  state: ActiveReleaseState;
}): React.JSX.Element {
  const current = state.details ?? state.release;
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

      {state.pollError ? (
        <div className="request-warning" role="alert">
          <p>{state.pollError}</p>
          <button onClick={onResumeStatus} type="button">Resume status checks</button>
        </div>
      ) : null}
      {current.status === "ERROR" ? (
        <div className="retry-release">
          <button disabled={state.retrying} onClick={onRetryRelease} type="button">
            {state.retrying ? "Retrying release…" : "Retry release"}
          </button>
          {state.retryError ? <p role="alert">{state.retryError}</p> : null}
        </div>
      ) : null}
      {state.details ? <Lifecycle transitions={state.details.transitions} /> : null}
      {state.details ? <TestRuns testRuns={state.details.testRuns} /> : null}
      {terminal ? (
        <Evidence
          artifacts={state.artifacts}
          error={state.evidenceError}
          loading={state.evidenceLoading}
          onRetry={onRetryEvidence}
        />
      ) : null}
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
        <ul className="test-run-list">
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

function Evidence({
  artifacts,
  error,
  loading,
  onRetry
}: {
  artifacts: ReleaseArtifact[];
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section aria-label="Release evidence">
      <h2>Evidence</h2>
      {loading ? <p aria-live="polite" role="status">Loading persisted evidence…</p> : null}
      {error ? (
        <div className="request-warning" role="alert">
          <p>{error}</p>
          <button onClick={onRetry} type="button">Retry evidence</button>
        </div>
      ) : null}
      {!loading && !error && artifacts.length === 0 ? <p>No persisted evidence was returned.</p> : null}
      {artifacts.length > 0 ? (
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
      ) : null}
    </section>
  );
}

interface PollReleaseOptions {
  client: ReleaseAppClient;
  controller: AbortController;
  generation: number;
  generationRef: React.MutableRefObject<number>;
  maxPollIntervalMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  release: ReleaseSummary;
  setState: React.Dispatch<React.SetStateAction<ReleaseState>>;
}

async function pollRelease({
  client,
  controller,
  generation,
  generationRef,
  maxPollIntervalMs,
  pollIntervalMs,
  pollTimeoutMs,
  release,
  setState
}: PollReleaseOptions): Promise<void> {
  const startedAt = Date.now();
  let nextIntervalMs = pollIntervalMs;

  try {
    while (generationRef.current === generation) {
      const remainingMs = Math.max(pollTimeoutMs - (Date.now() - startedAt), 0);
      const details = await requestBeforeDeadline(
        client.getRelease(release.id, controller.signal),
        remainingMs,
        controller
      );
      if (generationRef.current !== generation) return;
      updateActiveState(setState, release.id, (active) => ({
        ...active,
        details,
        pollError: null,
        polling: !terminalStatuses.has(details.status)
      }));
      if (terminalStatuses.has(details.status)) {
        await loadArtifacts(client, release, controller, generation, generationRef, setState);
        return;
      }
      if (Date.now() - startedAt >= pollTimeoutMs) {
        updateActiveState(setState, release.id, (active) => ({
          ...active,
          pollError: "Status checks paused before a terminal result. Resume to continue polling.",
          polling: false
        }));
        return;
      }
      const remainingAfterRequestMs = Math.max(pollTimeoutMs - (Date.now() - startedAt), 0);
      await delay(Math.min(nextIntervalMs, remainingAfterRequestMs), controller.signal);
      if (Date.now() - startedAt >= pollTimeoutMs) throw new PollTimeoutError();
      nextIntervalMs = Math.min(Math.max(nextIntervalMs * 2, 1), maxPollIntervalMs);
    }
  } catch (error) {
    if (generationRef.current === generation && error instanceof PollTimeoutError) {
      updateActiveState(setState, release.id, (active) => ({
        ...active,
        pollError: "Status checks paused before a terminal result. Resume to continue polling.",
        polling: false
      }));
    } else if (generationRef.current === generation && !isAbortError(error)) {
      updateActiveState(setState, release.id, (active) => ({
        ...active,
        pollError: error instanceof Error ? error.message : "Status checks paused",
        polling: false
      }));
    }
  }
}

class PollTimeoutError extends Error {
  public constructor() {
    super("Release polling deadline expired");
    this.name = "PollTimeoutError";
  }
}

function requestBeforeDeadline<T>(
  request: Promise<T>,
  timeoutMs: number,
  controller: AbortController
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => finish(() => reject(new DOMException("Request aborted", "AbortError")));
    const timer = setTimeout(() => {
      finish(() => reject(new PollTimeoutError()));
      controller.abort();
    }, timeoutMs);
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
    void request.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

async function loadArtifacts(
  client: ReleaseAppClient,
  release: ReleaseSummary,
  controller: AbortController,
  generation: number,
  generationRef: React.MutableRefObject<number>,
  setState: React.Dispatch<React.SetStateAction<ReleaseState>>
): Promise<void> {
  updateActiveState(setState, release.id, (active) => ({
    ...active,
    evidenceError: null,
    evidenceLoading: true,
    polling: false
  }));
  try {
    const artifacts = await client.listArtifacts(release.id, controller.signal);
    if (generationRef.current !== generation) return;
    updateActiveState(setState, release.id, (active) => ({
      ...active,
      artifacts,
      evidenceLoading: false
    }));
  } catch (error) {
    if (generationRef.current === generation && !isAbortError(error)) {
      updateActiveState(setState, release.id, (active) => ({
        ...active,
        evidenceError: error instanceof Error ? error.message : "Evidence unavailable",
        evidenceLoading: false
      }));
    }
  }
}

function createActiveState(release: ReleaseSummary): ActiveReleaseState {
  return {
    artifacts: [],
    details: null,
    evidenceError: null,
    evidenceLoading: false,
    pollError: null,
    polling: true,
    release,
    retryError: null,
    retrying: false,
    status: "active"
  };
}

function updateActiveState(
  setState: React.Dispatch<React.SetStateAction<ReleaseState>>,
  releaseId: string,
  update: (state: ActiveReleaseState) => ActiveReleaseState
): void {
  setState((current) => current.status === "active" && current.release.id === releaseId
    ? update(current)
    : current);
}

function delay(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isUncertainSubmissionError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof ReleaseApiError && error.status >= 500);
}
