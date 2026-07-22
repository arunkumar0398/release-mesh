# Render Deployment

ReleaseMesh is described by the root `render.yaml` Blueprint. Sync the Blueprint from the private GitHub repository after granting Render access to the repository.

## Public services

| Runtime | Expected HTTPS URL |
| --- | --- |
| Shell Render static site | `https://arunkumar0398-releasemesh-shell.onrender.com` |
| Catalog Render static site | `https://arunkumar0398-releasemesh-catalog.onrender.com` |
| Release Render static site | `https://arunkumar0398-releasemesh-release.onrender.com` |
| Checkout Render static site | `https://arunkumar0398-releasemesh-checkout.onrender.com` |
| Control-plane API web service | `https://arunkumar0398-releasemesh-api.onrender.com` |
| Pricing fixture web service | `https://arunkumar0398-releasemesh-pricing.onrender.com` |

The runner is a paid background worker with no public listener. Render Postgres and Render Key Value provide hosted database and BullMQ runtime dependencies.

Free Render Postgres expires after 30 days and free Key Value is in-memory. Provision near judging or upgrade, then rerun the public smoke suite before submission. If Key Value restarts, the runner's `releaseId` reconciliation re-enqueues missing old `QUEUED` jobs from PostgreSQL.

## Required secrets

Set these when the Blueprint prompts for `sync: false` values:

* `OPENAI_API_KEY` on the runner only. It is never exposed to a static site or the API response surface.
* `DEMO_RESET_TOKEN` on the control-plane API only. Use a random value and share it outside the repository.

The runner uses `PostgresArtifactStore`. JSON evidence, sanitized logs, and bounded screenshots remain accessible to the API without a shared filesystem. Missing or failed GPT access persists `AI_UNAVAILABLE` with a deterministic/rule-based explanation; it never changes the deterministic gate result.

## Blueprint behavior

* Shell, Catalog, Release, and Checkout use `runtime: static`, explicit `buildCommand`, and explicit `staticPublishPath` values.
* Catalog and Release expose stable `/mf-manifest.json` and `/remoteEntry.js` URLs with `Cache-Control: no-store`.
* Hashed `/assets/*` responses use `Cache-Control: public, max-age=31536000, immutable`.
* Remote responses allow cross-origin loading from the Shell HTTPS origin.
* The free API service generates Prisma, deploys migrations, and applies the repeatable seed before starting; it permits only the four frontend origins and reports PostgreSQL, Redis, and worker heartbeat state at `/healthz`.
* Pricing starts in the v1 baseline mode.
* The runner uses the paid `starter` plan and has no `healthCheckPath` or inbound HTTP port.

## Deploy

1. Merge the approved M7 checkpoint to `master`.
2. In Render, create a Blueprint from `https://github.com/arunkumar0398/release-mesh` and select `render.yaml`.
3. Supply both required secrets and confirm the runner plan is `starter` or higher.
4. Wait for the API startup migration/seed and every service deployment to complete.
5. Run the checks below, then follow `docs/demo-runbook.md`.

## Verification

```powershell
render blueprints validate render.yaml
curl.exe -fsS https://arunkumar0398-releasemesh-api.onrender.com/healthz
curl.exe -fsS https://arunkumar0398-releasemesh-pricing.onrender.com/pricing/checkout-demo
curl.exe -I https://arunkumar0398-releasemesh-catalog.onrender.com/mf-manifest.json
curl.exe -I https://arunkumar0398-releasemesh-release.onrender.com/mf-manifest.json

$env:DEPLOYED_API_URL = "https://arunkumar0398-releasemesh-api.onrender.com"
$env:DEPLOYED_CATALOG_URL = "https://arunkumar0398-releasemesh-catalog.onrender.com"
$env:DEPLOYED_CHECKOUT_URL = "https://arunkumar0398-releasemesh-checkout.onrender.com"
$env:DEPLOYED_PRICING_URL = "https://arunkumar0398-releasemesh-pricing.onrender.com"
$env:DEPLOYED_RELEASE_URL = "https://arunkumar0398-releasemesh-release.onrender.com"
$env:DEPLOYED_SHELL_URL = "https://arunkumar0398-releasemesh-shell.onrender.com"
$env:DEMO_RESET_TOKEN = "<server-side reset token>"
corepack pnpm test:e2e deployed-smoke
```

The deployed smoke test must report a fresh worker heartbeat, uncached manifests, immutable hashed assets, successful runtime composition, and repeatable `BLOCKED` then `SAFE` gates. Until these commands pass against deployed URLs, the public deployment is not submission-ready.
