# PR #20 private rehearsal: offline preparation

Status on 2026-10-26: prepared, NOT deployed or accepted.
The MSI device holding the existing authorized Cloudflare login is offline.
The user requested offline preparation. No production merge or deploy is allowed.

## Fixed resources

- Account: 9bf1848f94dd5acd6989dfb705adba37 (existing documented rehearsal account).
- NEW Worker: workflows-starter-template-pr20-staging.
- Workflow: shion-av-content-pipeline-pr20-staging.
- DO: WORKFLOW_STATUS / WorkflowStatusDO, local to that new Worker, additive v1.
- Public routes, workers.dev and version preview URLs: disabled.
- Existing workflows-starter-template-staging already has v2. Do not deploy the
  v1-only hotfix there, remove its classes, or reuse its namespaces.

The default production config is unchanged. CI validates emitted staging config,
two frozen historical API/Workflow/DO source fixtures and the collector guards.
Fixture bundles omit frontend assets; their Worker source files are exact copies
of the listed commit, with an isolated config. They are not byte-identical
production bundles. No source timeout or media operation is changed.

## Offline checks

Use Node 24, npm ci --progress=false, npm run verify, npm run check:pr20-staging.
The final command validates 22 guards, dry-runs the candidate, then builds and
dry-runs historical main (51d36ce7...) and PR18 (9f9aace4...) fixtures.
The checkout needs those Git objects; CI fetches full history. All operations
in this command are non-deploying. Inspect manifests and hashes in the fixture
artifact paths printed by the command.

## When the authorized connection is restored

1. Verify the account and NEW resource inventory read-only. Stop if this target
   already exists with different migration history, namespaces, bindings, routes,
   or retained instances. Do not overwrite unreviewed resources.
2. Record production active version/traffic and namespace read-only, and retain
   those records for the final unchanged-production comparison.
3. Use a clean checkout of the accepted PR20 head. Set CLOUDFLARE_ACCOUNT_ID to
   the fixed staging account through the existing session. Do not copy tokens,
   browser credentials or credential files.
4. Deploy the frozen legacy fixture using:
   node scripts/pr20-fixtures.mjs --deploy legacy-main
   Save artifact manifest, Cloudflare version, namespace and Workflow journal
   evidence. Start the local-only service-binding proxy from a separate shell:
   node node_modules/wrangler/bin/wrangler.js dev --config scripts/pr20-proxy/wrangler.json --ip 127.0.0.1 --port 8799
   Never deploy that proxy or expose its local port.
5. Create disposable waiting histories:
   node scripts/pr20-acceptance.mjs start-legacy PATH_OUTSIDE_REPO/main-legacy.json
   Capture an independent engine journal and raw application-storage backup.
   Deploy the frozen PR18 fixture:
   node scripts/pr20-fixtures.mjs --deploy pr18
   Create another legacy receipt with a different filename. Keep the original
   namespace UUID and both histories. Also capture a rejected PR18 control in a
   separately created disposable instance; never send decisions to unknown IDs.
6. Deploy PR20 with its staging guard:
   node scripts/pr20-staging.mjs --deploy EXACT_REVIEWED_HEAD_SHA
   The command requires the selected account, exact clean checkout and private
   emitted config. It does not accept name, route or namespace overrides.
7. For each receipt less than 50 minutes old:
   node scripts/pr20-acceptance.mjs check-legacy START_RECEIPT RESULT_FILE
   This sends false/true/string only to the disposable ID recorded by start-legacy.
   Expect 409/409/400, engine still waiting/running, same original snapshot and
   matching fresh WebSocket connections. Any unexpected forwarding stops the
   check immediately. Preserve the journal and do not restart/delete the ID.
8. Independently compare each raw original storage backup byte/field hash before
   and after, and inspect the actual engine journal for NO publish checkpoint.
   The collector compares observable snapshots (ignoring timestamp and treating
   missing optional errorMessage as null); it cannot prove raw storage identity
   or journal absence. Its receipts deliberately keep journalVerified and
   storageBackupVerified false until separate evidence is reviewed.

## Natural 60-minute acceptance

Create a NEW instance under the verified candidate deployment:

node scripts/pr20-acceptance.mjs start-timeout START_RECEIPT

The receipt includes the ID, zero events sent by this collector, first observed
waiting time and the earliest collection time. Do not send it any event, alter
its timeout, restart it or force a timeout. Audit external senders separately.

After at least 60 actual minutes from observed waiting (allow scheduling slack):

node scripts/pr20-acceptance.mjs collect-timeout START_RECEIPT RESULT_FILE

The collector uses only status GET and two new WebSocket connections. It refuses
early collection and requires engine errored, durable APPROVAL_TIMEOUT, review error, publish pending, null currentStep
and equal terminal snapshots after reconnect. Early/not-yet-terminal cases fail
and retain receipts; elapsed time alone is not a pass. Also verify the independent
engine journal has no publish and save durable storage evidence. Reconnection
does NOT prove cloud DO eviction. Forced eviction remains local test evidence
unless observed independently on the actual platform.

Repeat new true/false/invalid controls on separate disposable IDs and inspect
journals. API malformed inputs must not publish; do not infer engine-injection
coverage from HTTP validation alone. Check active WebSocket rejection/timeout
notifications and late-event handling. All media steps remain simulations.

## Following PR #16

PR #21 supplies rejected/errorMessage and original-DO RPC compatibility for the
later isolation rollout. Its tests do not prove cloud replay. Before exercising
that transition, prepare a separately reviewed additive-v2 staging config that
retains this rehearsal's original Workflow and namespace names. Do not run the
PR20 v1-only guard against an already-v2 Worker, or blindly use PR16's different
staging names. Keep in-flight PR20 timeout instances and confirm their markError
RPC still saves to the original DO. Original /ws must remain live; /ws/av must
refuse historical IDs. No migration or production authorization is implied here.

## Evidence required for acceptance

- Exact source and emitted-artifact hashes; deployed version and Workflow version.
- Staging account, routing settings, original namespace before/after.
- Pre-upgrade engine IDs and journals, receipt decisions and independent before/
  after storage comparison; no historical publish checkpoint.
- Natural timeout timestamps, zero-event audit, engine terminal error, original
  DO terminal state and separate WebSocket reconnect captures.
- Unchanged production active version/traffic/namespace records.
- Explicit unresolved items, including direct API/binding senders and retry
  exhaustion. A passing build, forced timeout or receipt alone is insufficient.
