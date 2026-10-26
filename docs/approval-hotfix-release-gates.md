# Approval hotfix release gates

This branch extends PR #18 at `9f9aace4f12d06f6fe7b662a61ad629bec6dda15`.
It is a review candidate, not production authorization. Main auto-deploys.
Keep the Worker name, SHION_WORKFLOW, WORKFLOW_STATUS and migration v1 unchanged.

## Scope

- The executing strict Workflow writes `approvalGateVersion=strict-editorial-v1`
  in its original status DO before starting work. HTTP start does not write it.
- The event route returns 409 for unmarked IDs before getting an engine handle.
  Invalid payloads still return 400. Already stopped engines return 409.
- Existing instances, including ones created by unmodified PR #18, stay
  unmarked and require individual review. Do not mass-mark, restart, delete,
  copy a marker, or send test approval/rejection decisions to them.
- Registration, notifications, approval validation and terminal recording are
  journaled steps. Status writes retry; pre-publish status failure stops publish.
  Terminal fields are written together, and retries repair a failed in-memory
  terminal transition. Exhausted persistence failure is logged without payload.
- Normal new instances still require explicit boolean true. Media is simulated.

## Evidence and limits

The existing head's Actions job passed 8 Workers tests. Its Cloudflare
non-production version upload succeeded; this is not proof of promoted traffic
or that old histories execute the new approval gate.

A separate Node harness using exact source modules with mocked Cloudflare
services reproduced old-event forwarding, lost timeout status on a transient
RPC failure, and mislabeled publish failure. All 12 diagnostic/candidate checks
passed locally. This is failure-injection evidence, not a cloud runtime test.

The added Workers suite checks invalid/rejected decisions with a publish
tripwire, timeout and rejection WebSocket broadcasts, terminal snapshots after
eviction, late approvals, unmarked waiting-instance preservation, generic
snapshot readability, registration/pre-publish/publish failures and bad JSON.
Its unmarked fixture runs the new engine with its marker removed; it is not a
real pre-deployment Workflow history. Exact-head Actions results must pass
before this branch is accepted.

## Required private rehearsal

1. Obtain approval for a named isolated Worker/account; use independent Workflow
   registrations and DO namespaces, with public routes and preview URLs disabled.
   Do not treat a version preview sharing production bindings as isolation.
2. Create historical generic, historical main AV and unmodified PR #18 waiting
   instances before upgrade. Deploy this candidate in that isolated environment.
3. For every historical AV ID, prove both decisions cannot be forwarded by this
   HTTP route; engine journals and original DO snapshots remain unchanged.
   Original WebSocket reads must remain available. Inspect actual journals;
   version labels alone are insufficient.
4. Exercise new true/false/invalid decisions, repeat/late events, a natural
   60-minute timeout, terminal reconnects and injected status-storage failures.
   Assert publish is absent on rejection, invalid decision or timeout.
5. Inventory and control direct Cloudflare API, binding and queued event senders.
   They bypass this HTTP guard. Restricting HTTP does not fix an old engine or
   retract an event already queued. If these cannot be controlled, do not release.
6. Verify original generic Workflow registrations and consumers. This hotfix
   keeps current main configuration; it does not restore MY_WORKFLOW or generic
   event routing. Readable generic snapshots alone do not prove engine continuity.
7. Take fresh production inventory/backup, obtain explicit deployment approval
   for the exact artifact/window, and define abort/forward-fix criteria before
   any main merge or promotion. A rollback to ungated code reopens the flaw.

## Follow-on PR #16

Rebase/integrate deliberately; do not blindly cherry-pick its worker/index.ts,
Workflow or DO files over this branch. PR #16 supplies generic/AV separation,
original and AV namespaces/routes, historical AV quarantine and additive v2.

Before that integration, extend its legacy snapshot contract for PR #18's
`rejected` workflow/step values and `errorMessage`, while still rejecting mixed
or unknown data. Its current validator throws for such snapshots, including on
the original /ws route. Add fixtures for completed, rejected, timeout, waiting
and generic states from this hotfix. Never use a copied one-time snapshot as a
live feed or convert a historical failure into approval.

The v2 bootstrap must start from the exact main that exists after the accepted
hotfix, retain its guards and original handlers, and add only the required
class/binding/migration. Rehearse it privately, then obtain separate production
migration approval. Retain v1/v2 and original namespaces for forward recovery.
PR #16's recorded natural timeout and newest failed Builds diagnostics remain
uncollected in the reviewed repository evidence; they are not accepted here.
