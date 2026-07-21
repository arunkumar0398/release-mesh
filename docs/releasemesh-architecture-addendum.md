# ReleaseMesh Architecture Addendum

**Status: Approved**

This addendum records Build Week packaging and deployment decisions without changing the locked architecture in `docs/releasemesh-architecture.md`.

## In-process risk engine

For Build Week, GPT-5.6 planning, evidence sanitization, structured-output validation, deterministic fallback, and remediation intelligence live in `packages/risk-engine`.

* `services/runner-worker` is the only executable that invokes the package.
* The package has no HTTP listener, queue, database client, or independent runtime.
* GPT-5.6 returns advisory planning and analysis data only.
* Mandatory tests are always `mandatoryTests union allowlistedAdvisoryTests`; GPT cannot remove a mandatory test or select arbitrary execution.
* `SAFE`, `BLOCKED`, and `ERROR` remain deterministic results computed from trusted checks and durable evidence.
* Missing credentials, timeout, transport failure, or invalid structured output persists `AI_UNAVAILABLE` with an explicitly labelled `deterministic/rule-based` explanation.

After Build Week, `packages/risk-engine` may be extracted behind the same validated input/output contracts and server-side credentials. Extraction must not move release-gate authority, introduce arbitrary repository execution, or require the control-plane API to import worker infrastructure.

## Shared database package

`packages/database` owns the Prisma schema, generated client, migrations, seeds, repositories, worker heartbeat persistence, and risk-assessment persistence used by both backend executables.

* `services/control-plane-api` and `services/runner-worker` depend directly on `packages/database`.
* The worker never imports database infrastructure from the API service.
* Release lifecycle transitions and idempotency remain transactional and database-enforced.

## Artifact storage modes

Both artifact implementations satisfy the `ArtifactStore` contract.

* `LocalArtifactStore` supports isolated local development and contract testing without exposing filesystem paths to callers.
* The integrated Docker Compose stack and hosted Render runtime use `PostgresArtifactStore` so the API and worker share durable JSON evidence, sanitized logs, and bounded demo screenshots without a shared filesystem.
* GPT-5.6 receives structured sanitized evidence and screenshot metadata, never screenshot bytes or raw unsanitized logs.

These modes keep the API and worker independent of a shared or persistent local filesystem.
