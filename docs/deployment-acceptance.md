# SHION workflow deployment acceptance

This repair extends PR #16 (`3536d05c5bd94cdc8fc25b56228513f35724ff8b`), which
restores the generic demo and isolates SHION. It does not replace the completed
AV template, agent launchers, or other SHION development features.

## Verified locally

Node.js 24, a clean locked install, and `npm run verify`: lint, TypeScript/Vite
build, 25 Workers-runtime tests, and Wrangler deployment dry-run. Both original
bindings plus `SHION_WORKFLOW` and `AV_WORKFLOW_STATUS` are packaged. No deploy
command is run. The existing `undici`/`zod` security overrides in PR #16 are retained.

The tests include true/false decisions, seven malformed payload shapes, timeout,
wrong event type, late/duplicate decisions, ingest/publish/notification failures,
live WebSocket error delivery, reconnect/eviction, retained legacy routing,
pre-isolation AV snapshot copying and alias routing, mixed-schema refusal,
identical IDs in independent namespaces, and protection against state regression.
A publish-step tripwire verifies denied decisions never enter that step.

These are **simulation tests**. The positive test executes the simulated media
bodies; most other media steps/sleeps are mocked. Timeout is forced through the
runtime test API rather than waiting 60 minutes. Expected failure cases log
runtime exceptions. The runtime can also log canceled-request diagnostics during
instance startup/disposal; all assertions and process exits must still pass.

## Confirmed Cloudflare build blocker and staging rehearsal

The originally reported PR head, `f97cab03e7481d84d1305d25ed559ec37cd2b071`,
passed Actions run `40064218872`, but Cloudflare build
`52fe742a-d61a-4e1f-8eac-297a9b94efc5` failed during **version upload**, after
`npm run build` succeeded. The actual dashboard run took approximately 42 seconds;
GitHub's equal check timestamps do not show its execution duration. The log
explicitly reports a pending Durable Object migration that `versions upload`
cannot apply. Quota exhaustion, an account outage and a Workflow binding failure
are not established causes of this run. See the [diagnosis](build-diagnosis-2026-10-24.md).

Use the added staging environment to rehearse the additive v1/v2 migrations with
independent resource names. Bindings and class names stay identical to production,
but the Worker is `workflows-starter-template-staging` and the Workflows are
`my-workflow-staging` / `shion-av-content-pipeline-staging`. Local DO bindings
create namespaces belonging to this separate Worker, without a production
`script_name`. Public workers.dev/version URLs and routes are disabled.

```bash
npm run check:staging
```

This builds with `CLOUDFLARE_ENV=staging`, checks the **emitted** Vite configuration
and performs a dry run. Ten guard tests cover accidental production targeting,
public routes, shared namespaces and destructive migrations. No credentials or
deployment are needed. GitHub Actions runs this check separately after verify.

For an explicitly selected, authorized Cloudflare account, the migration rehearsal
command is `npm run deploy:staging`; set `CLOUDFLARE_ACCOUNT_ID` in that environment
first. It rebuilds and validates the same isolated target before `wrangler deploy`.
It accepts no target overrides. If used through Workers Builds, connect the
**separate staging Worker**, rather than replacing the production project's
version command. Neither command changes production's migrations or Workflow IDs.
Review the staging resource inventory before deploying into an existing staging
Worker. HTTP/WebSocket checks need an authorized private entry point or `wrangler
tail`/Workflow engine evidence; this script deliberately does not expose a URL.

Staging provisioning does not apply production's pending migration, repair the
original production-target version-upload check, back up live snapshots, or
prove replay compatibility with historical production instances. Do not remove
v2, remove bindings, rename resources, replace the version command with a success
placeholder, or deploy the PR directly to production to make that check green.
The current main-branch build command is `npm run deploy`: merging this PR would
initiate a production deployment, so merge remains gated on the acceptance below.

## Before production promotion

- Require GitHub Actions verification and Cloudflare build success for the exact
  proposed commit. A build/version upload alone does not prove active traffic,
  deployed bindings, namespace IDs, or existing-instance compatibility.
- Inventory both `my-workflow` and `shion-av-content-pipeline` active/waiting
  instances and external callers. Confirm `WORKFLOW_STATUS` still names the
  original namespace and both v1/v2 migration histories match the account.
- In staging, resume representative pre-PR #6 and PR #6 instances using their
  original event types and verify checkpoint replay, status APIs, old/new
  WebSocket protocols, eviction and reconnect. Local tests seed old snapshots;
  they do not replay an actual pre-upgrade production execution history.
- Keep backups of original snapshots. Do not delete or bulk-restart instances.
  Investigate mixed/unknown data manually. Copying is deliberately non-destructive.
- Update PR #6 external AV-start clients to `/api/av/workflow/start`. A SHION
  instance with no recognizable old snapshot must use the explicit AV routes.
- Exercise status-service outages. Notification and failure persistence have
  durable retries. If both are unavailable, the Workflow still fails closed,
  but the WebSocket snapshot may be stale: consult the engine status API.
- Confirm the intended Worker version and request production promotion only
  after those concrete staging results are reviewable.

## Before real media publication

The demo uses fixed metadata, timers and `console.log`; no real media upload,
transcoding or channel publication has been accepted.

- Authenticate and authorize reviewers/event senders. The demo HTTP endpoint has
  no reviewer authentication; `approved: true` alone is not proof of identity.
- Bind approval to a specific media revision and destination.
- Make publication idempotent and retain a verifiable external publication ID.
- Test approved, rejected, malformed and timed-out runs against a private test
  channel. Denied runs must make zero calls to the real publisher. Verify output
  hashes, media quality and A/V sync separately.

References: [Cloudflare event semantics](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
and [Workflow errors](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).
