# Compatibility with PR #18 / #20

This change is based on PR #16 at 807d9e629536bb1970fb29125bb9379bebaf9d80.
It prepares the subsequent integration after the minimal PR #20 hotfix.
Main merge and production deployment remain unauthorized.

The original status namespace can contain PR #18 / #20 AV states with rejected
step/workflow values and optional errorMessage. Read and validate those values
without modifying the original storage. Keep malformed or mixed schemas blocked.
The optional field remains absent on older generic and AV envelopes when it was
absent in storage.

Retain PR #20's registerApprovalGate, hasApprovalGate and markError RPCs on the
original DO class: already-running hotfix workflows can still call that class
after an upgrade. Retain terminal-state and replay guards and atomic writes.
Without these RPCs, a workflow's eventual timeout cannot record its terminal
state even if the snapshot validator accepts rejected.

All recognizable legacy AV IDs remain quarantined on both HTTP event routes,
including IDs carrying the PR #20 marker. The marker must not be copied to the
isolated namespace or treated as approval. Original /ws reads the live original
DO; /ws/av continues refusing a legacy ID. A one-time import preserves the error
message but is never a live feed, and cannot replace newer isolated state.

Workers tests cover PR18 and PR20 waiting/completed/rejected/timeout/invalid
snapshots, both event routes and all decisions, original storage identity,
eviction/reconnect, a live timeout via retained RPCs, generic envelope
compatibility, copy behavior and malformed data. These are local Workers
runtime tests, not an actual cloud upgrade or natural 60-minute timeout.

Private staging still requires pre-upgrade engines, real journals, snapshot
hash comparison and a natural timeout. The authorized MSI connection was offline
on 2026-10-26; the user requested offline preparation. No deployment was made.
