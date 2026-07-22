# Public Demo Runbook

## Warm up and health

```powershell
$api = "https://arunkumar0398-releasemesh-api.onrender.com"
$shell = "https://arunkumar0398-releasemesh-shell.onrender.com"
curl.exe -fsS "$api/healthz"
```

Expected: HTTP 200 with `database: "up"`, `redis: "up"`, and `worker.fresh: true`. A stale worker heartbeat remains visible but is informational; PostgreSQL or Redis failure makes the API health response degraded.

## Reset the fixed scenario

The route accepts no release ID, repository, command, URL, or other arbitrary input.

```powershell
$env:DEMO_RESET_TOKEN = "<server-side reset token>"
curl.exe -i -X POST "$api/demo/reset" `
  -H "content-type: application/json" `
  -H "x-demo-reset-token: $env:DEMO_RESET_TOKEN" `
  --data "{}"
```

Expected: HTTP 204. HTTP 409 means a release job is active; wait for its terminal state and retry. Locally, with the queue idle, the equivalent database command is:

```powershell
$env:DATABASE_URL = "postgresql://releasemesh:releasemesh@127.0.0.1:5433/releasemesh"
corepack pnpm demo:reset
```

## Judge flow

1. Open the Shell URL and confirm both Catalog and Release remote versions are visible.
2. Open Checkout and show the v1 Pricing baseline rendering `INR 1299`.
3. In Release Centre, select **Validate Pricing v2**.
4. Wait for the deterministic gate to show `BLOCKED`.
5. Show DRAFT through BLOCKED lifecycle history, all three mandatory tests, contract diff, sanitized API log, browser screenshot, and Checkout as the affected consumer.
6. Show the GPT-5.6 explanation, or the explicitly labelled deterministic/rule-based `AI_UNAVAILABLE` fallback. Emphasize that neither can change gate authority.
7. Select **Validate Pricing v2.1**.
8. Wait for all mandatory checks and the deterministic `SAFE` gate.
9. Repeat the reset once to prove the public demo is reusable.

Never paste `OPENAI_API_KEY` or `DEMO_RESET_TOKEN` into the browser, recording, repository, or model evidence.
