# ReleaseMesh Execution Notes

These notes amend the approved execution plan without changing the locked architecture.

## Queue retry handling

* BullMQ jobs use `releaseId` as `jobId`.
* A terminal queue job is removed only after the release's database state and evidence are durable.
* Before retrying an `ERROR` release, remove its previous terminal queue job, then persist `ERROR -> QUEUED` and enqueue the new job using the same `jobId`.
* Integration coverage must exercise `ERROR -> retry -> QUEUED -> TESTING -> terminal`.

## Render frontend hosting

* Deploy Shell, Catalog MFE, Release MFE, and Checkout as Render static sites.
* Configure each static site's build command, static publish path, remote-manifest cache policy, immutable hashed-asset cache policy, and CORS headers directly in `render.yaml`.
* Keep the API and Pricing fixture as Render web services and the runner as a paid Render background worker.

## M1 database bootstrap

* Run `corepack pnpm --filter @releasemesh/database migrate:deploy` before seeding a database.
* Run `corepack pnpm --filter @releasemesh/database seed` to regenerate the ignored Prisma client and seed the repeatable Checkout/Pricing catalogue.
