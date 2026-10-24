# Authorized cloud rehearsal — 2026-10-24

Production is **not approved for merge or deployment**. Main automatically runs
`npm run deploy`. The account's real private staging target was used, with no
public routes, workers.dev URL or version preview URL. Production names, original
namespace, migration history and instances were preserved.

## Production inventory and backup

| Evidence | Observed value |
| --- | --- |
| Active production Worker version (100%) | `5a3defac-dbae-4b5d-a925-4c2045c81afc` |
| Active deployment | `e7c3a591-e5e9-4320-9151-f7d42f83893e` |
| Active runtime migration tag | `v1` |
| Original `WorkflowStatusDO` namespace | `564deb0be97b4570b2ae903007f04f0f` |
| Stored DO objects enumerated | One; second cursor page empty |
| Application snapshot backup | 415 bytes, SHA-256 `41B9FBEEDB9E9062EAFA0DB555A5FE4BA966A224C72337FD7252FEC2762F59F3` |

The backup is on the authorized MSI device at
`D:\DevCache\shion-pr16-evidence-4d69dfe\production-status-snapshot.json`.
It was read through the existing `getStateMessage()` application RPC using a
temporary read-only remote preview, without deploying a production handler.
It contains the three persisted application state fields, not a complete SQLite
database/PITR backup or proof of Workflow-engine restorability. Its generic
approval-waiting state may be historical: both engine lists currently showed
zero retained instances and a three-day retention period. Zero counts do not
establish that no historical data or external clients exist.

The settings, eight deployment records, active version, Workflow list and both DO
object pages were also saved on that device. After staging v2, production still
served the same version at 100%, and the application snapshot was identical
excluding its generated read timestamp. No production event, restart or deletion
was issued. Recheck this inventory and take a fresh backup immediately before any
authorized production migration.

## Real isolated migration

| Staging deployment | Worker version |
| --- | --- |
| Historical generic implementation, v1 | `8ca307c9-c283-4799-a2c0-0dbc344004df` |
| Historical main AV implementation, v1 | `02ea5097-481c-49b3-a889-f832fe80cfa1` |
| Exact PR head `4d69dfe`, v2 | `4ff70f2c-2601-442b-845c-9dea4536f6db` |

Worker: `workflows-starter-template-staging`. Workflow registrations:
`my-workflow-staging` / `shion-av-content-pipeline-staging`. The historical AV
fixture retained its original AV implementation, with an extra generic export
and registration so that the generic rehearsal instance was not removed.
It is not a byte-identical production bundle.

The deployed version API confirms migration tag `v2` and all four bindings.
Original staging status namespace: `fb67d9436d644c1494c4ea4203edab00`.
New staging AV namespace: `97d40d9d500d4ebaa7588732c28f6e35`.
Both are independent of production's namespace.

HTTP and WebSocket requests used a loopback-only Wrangler service-binding proxy
to the actual deployed staging Worker. Workflow engine logs/status came from the
authenticated Cloudflare API/CLI. These are remote executions, not local Miniflare
assertions; all media bodies still simulate ingest/transcode/publication.

## Actual execution results on `4d69dfe`

| Case | Actual instance | Result |
| --- | --- | --- |
| Generic created under v1, resumed after upgrades | `f26f2f2c-dd78-4566-96b9-71d88b203692` | Complete via original event route; old checkpoints retained |
| New AV, boolean true | `2d1fb751-84f8-4c9f-bbb5-2a4ab2fa76b2` | Complete; journal includes validation and simulated publish |
| New AV, boolean false | `e9e185c1-7462-4a6a-ab5b-21218bb031cf` | Errored, `APPROVAL_REJECTED`; no publish step in engine journal |
| New AV, string `"true"` | `dd666bc8-8c75-4c08-b9ec-eac84cef7956` | Errored, `INVALID_APPROVAL`; no publish step in engine journal |
| New AV, no event, real 60-minute timeout | `ad5df2ad-0648-4d58-9939-55d8c0281229` | Started 14:23:21Z; waiting at last inspection; natural timeout still requires collection |
| Historical AV, true | `aeefc08a-279b-4b65-975c-085ac4e5dcf3` | Complete |
| Historical AV, false | `76e1abc4-675b-4559-a133-883d27a6805c` | **Unsafe: complete, false recorded by wait step, publish executed** |
| Historical AV, string `"true"` | `37b8f1d1-d888-46e3-8755-9cdefb6c04f0` | **Unsafe: complete, publish executed** |

The historical journals contain the old four steps and no new validation or
notification checkpoints. Deploying the correction and copying a snapshot did
not establish that these waiting histories would execute the new gate. This
rehearsal therefore failed automatic historical AV safety acceptance. A Workflow
version label alone must not substitute for inspecting its actual step journal.

## Corrective boundary and release gates

Both old and explicit AV HTTP event routes now refuse recognizable historical AV
IDs with 409 `LEGACY_INSTANCE_REQUIRES_REVIEW` before forwarding any decision,
including true. The original engine, namespace and snapshot are retained. Their
original `/ws` reads the source DO live; `/ws/av` refuses them instead of presenting
the one-time imported copy as current state. Generic old routing is unchanged.

Local verification of this correction passes 27 Workers tests, including all
three decisions on both routes, preservation of a waiting instance and live
original-WebSocket updates after a copy. The ten staging guards and both Wrangler
dry-runs also pass. Remote quarantine verification and exact corrected-head CI /
review results must be recorded in the PR before release; the earlier `4d69dfe`
approval does not cover this correction.

Remaining gates: collect the real timeout outcome and durable WebSocket state;
verify corrected-head quarantine on still-waiting historical engines and new AV
decisions; review direct binding/API event callers and a per-history recovery
plan; perform a complete latest-head review; approve and execute the separate
production migration plan. Cloud DO eviction cannot be asserted from closing a
WebSocket or waiting briefly; forced eviction/recovery remains local-test evidence
unless explicitly observed in the actual environment.

Raw engine JSON, decision receipts, WebSocket captures and deployment logs remain
on the authorized device in the evidence directory above. No credentials or raw
production snapshots are committed to this public repository.
