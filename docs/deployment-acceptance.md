# SHION workflow deployment acceptance

This repair extends PR #16 (`3536d05c5bd94cdc8fc25b56228513f35724ff8b`), which
restores the generic demo and isolates SHION. It does not replace the completed
AV template, agent launchers, or other SHION development features.

## Verified locally

Node.js 24, a clean locked install, and `npm run verify`: lint, TypeScript/Vite
build, 23 Workers-runtime tests, and Wrangler deployment dry-run. Both original
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
