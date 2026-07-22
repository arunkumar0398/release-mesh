# Build Week Submission

## Project links

* Repository: `https://github.com/arunkumar0398/release-mesh`
* Default submission branch: `master`
* Checkpoint branch before merge: `feat/m7-render-deployment-submission`
* Submission tag after final verification: `build-week-submission`
* Demo: `https://arunkumar0398-releasemesh-shell.onrender.com`
* Health: `https://arunkumar0398-releasemesh-api.onrender.com/healthz`

## Repository access

The repository remains private. Before judging, grant private repository access to the required Build Week reviewer accounts and verify each invite can read `master`, the submission tag, `README.md`, `render.yaml`, and the architecture documents. Do not publish credentials or broaden application scope to add authentication.

## Submission checklist

- [ ] M7 checkpoint reviewed, committed, merged to `master`, and tagged `build-week-submission`.
- [ ] Render Blueprint validated and all four static sites, two web services, hosted datastores, and paid background worker are deployed.
- [ ] `OPENAI_API_KEY` and `DEMO_RESET_TOKEN` exist only as server-side Render secrets.
- [ ] Public `/healthz` reports PostgreSQL and Redis up with a fresh worker heartbeat.
- [ ] Public manifests are `no-store`; hashed remote assets are immutable and cross-origin accessible to Shell.
- [ ] Public reset returns 204 and the v2 `BLOCKED` then v2.1 `SAFE` runbook succeeds twice.
- [ ] Full lint, build, unit, integration, and Playwright suites pass on the submission commit.
- [ ] MIT `LICENSE` and repository access are verified.
- [ ] Run `/feedback` in this primary Codex thread and record the returned session ID here: **pending**.

## Video checklist

- [ ] State the developer-tool problem and show the locked architecture.
- [ ] Show independent Shell, Catalog, and Release remote versions.
- [ ] Show working Checkout against Pricing v1.
- [ ] Run Pricing v2 to persisted, evidence-backed `BLOCKED`.
- [ ] Show contract, API, and browser evidence plus Checkout blast radius.
- [ ] Show GPT-5.6 remediation intelligence or deterministic/rule-based fallback and state that the gate is deterministic.
- [ ] Run Pricing v2.1 to `SAFE`.
- [ ] Show `/healthz`, worker heartbeat freshness, and the reset workflow.
- [ ] Show Catalog failure isolation without breaking Release.
- [ ] Keep all API keys and reset credentials outside the recording.

Submission is not complete while any checkbox remains open.
