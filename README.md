# ReleaseMesh

ReleaseMesh is a production-shaped release-assurance control plane for the controlled Checkout -> Pricing demonstration. It runs trusted contract, API, and browser checks; persists evidence; computes a deterministic release gate; and optionally uses GPT-5.6 to explain risk and propose the smallest compatible remediation.

The approved source of truth is [`docs/releasemesh-architecture.md`](docs/releasemesh-architecture.md). Build Week packaging decisions are recorded in [`docs/releasemesh-architecture-addendum.md`](docs/releasemesh-architecture-addendum.md) and [`docs/releasemesh-execution-notes.md`](docs/releasemesh-execution-notes.md).

## Architecture

* `apps/shell` - Module Federation shell and remote boundary.
* `apps/release-mfe` - release creation, lifecycle, deterministic evidence, and advisory risk report.
* `apps/catalog-mfe` - seeded component, contract, ownership, and dependency catalogue remote.
* `services/control-plane-api` - catalogue and release lifecycle APIs.
* `services/runner-worker` - BullMQ worker, trusted checks, artifact collection, and heartbeat; no public HTTP listener.
* `packages/contracts` - deterministic lifecycle, gate, contract diff, and artifact contracts.
* `packages/database` - Prisma schema/client, repositories, seeds, and artifact persistence shared by API and worker.
* `packages/risk-engine` - isolated in-process advisory GPT-5.6 dependency used only by the worker.
* `fixtures/pricing` and `fixtures/checkout` - the only deployable demonstration fixtures.

Release authority is always the deterministic `SAFE`, `BLOCKED`, or `ERROR` gate. GPT-5.6 cannot approve a release, remove mandatory tests, or select arbitrary code.

## Local Setup

Prerequisites: Node.js 22.12+, Corepack/pnpm, Docker Desktop, and Playwright Chromium.

```powershell
corepack pnpm install
corepack pnpm exec playwright install chromium
docker compose up -d postgres redis
$env:DATABASE_URL = "postgresql://releasemesh:releasemesh@127.0.0.1:5433/releasemesh"
corepack pnpm --filter @releasemesh/database migrate:deploy
corepack pnpm --filter @releasemesh/database seed
corepack pnpm dev
```

Open `http://127.0.0.1:4174`, validate Pricing v2 for `BLOCKED`, then validate Pricing v2.1 for `SAFE`.

Docker Compose selects `LocalArtifactStore` with a disposable worker-local copy and durable PostgreSQL metadata/content, so the API does not depend on the worker filesystem. Reset the idle local demo with `corepack pnpm demo:reset` after setting `DATABASE_URL`.

## GPT-5.6

GPT credentials are server-side worker configuration only. Never put `OPENAI_API_KEY` in Shell, Release MFE, or Checkout environment variables.

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENAI_MODEL = "gpt-5.6"
corepack pnpm demo:ai-smoke
```

Without a key, the end-to-end demonstration remains complete and persists an `AI_UNAVAILABLE` assessment labelled `deterministic/rule-based`. Timeout or invalid output follows the same fallback and cannot change the deterministic gate result.

## Verification

```powershell
corepack pnpm lint
corepack pnpm build
corepack pnpm test
corepack pnpm test:e2e
```

Database integration tests require a PostgreSQL database whose name ends in `_test` via `TEST_DATABASE_URL`.

## Public Demo

The Render Blueprint deploys Shell, Catalog, Release, and Checkout as a Render static site each; API and Pricing remain web services; and the runner is a paid background worker with no public listener. Hosted Render Postgres and Key Value provide runtime state, while Render uses `PostgresArtifactStore` for evidence.

Expected Shell URL: `https://arunkumar0398-releasemesh-shell.onrender.com`

Deployment, reset, health, header, repository-access, and video instructions are in [`docs/deployment.md`](docs/deployment.md), [`docs/demo-runbook.md`](docs/demo-runbook.md), and [`docs/submission.md`](docs/submission.md). `OPENAI_API_KEY` is configured only on the runner.

## Codex Workflow

ReleaseMesh is implemented milestone-by-milestone in the primary Codex task with test-first checkpoints and review before integration. Run `/feedback` in that same primary task before submission; do not create a separate feedback session.
