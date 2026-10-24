# Production migration proposal — not executed or authorized

Do not merge PR #16 yet: main auto-deploys. The current production version is
`5a3defac-dbae-4b5d-a925-4c2045c81afc` at migration `v1`; the PR adds `v2` for
`AvWorkflowStatusDO`. Production-target `wrangler versions upload` cannot apply
that migration. Do not remove v2, rename classes/resources, replace the command
with a success placeholder, or deploy the full PR just to make its check green.

## Conditions before requesting execution approval

1. Record the exact proposed commit, clean Actions/audit/build results and a
   complete review. Re-run isolated staging against that commit. Require true,
   false, malformed, real timeout, reconnect and generic historical replay
   evidence. Require historical AV quarantine to preserve a waiting engine and
   its original snapshot; automatic AV recovery is not accepted.
2. Inventory both production Workflow registrations, retained engines, original
   namespace and all event senders, including direct bindings/API users. The HTTP
   guard cannot intercept privileged direct sends. Review each old AV history;
   do not bulk restart, delete, terminate, silently convert or approve it.
3. Re-export active version/settings/deployments/migration tag, enumerate original
   objects through the final empty cursor page, and refresh/hash the application
   snapshot backup. Record the scope of that backup and an agreed recovery path;
   do not describe an application JSON snapshot as a SQLite/PITR backup.
4. Prepare and review a separate bootstrap artifact based on exact main
   `51d36ce7b9d59da6e50c73407229467c3e4aeda1`. Keep its HTTP handler, original
   Workflow implementation, production names, existing bindings, assets and v1
   migration unchanged. Add only the new DO class export/binding and additive v2
   migration. Build it in an isolated checkout, inspect Vite's emitted config,
   record its tree/artifact hashes and dry-run, and rehearse that exact artifact
   on independent staging resources first. This document is a proposal, not a
   prepared or approved bootstrap deployment artifact.

## Separately approved execution sequence

1. Obtain approval naming the account, production Worker, bootstrap artifact hash,
   v1-to-v2 migration, expected new namespace and execution window. Keep PR #16
   unmerged. Use the original account's authorized CLI, never copied browser
   credentials.
2. Apply the reviewed bootstrap with `wrangler deploy` using its explicit audited
   production config. This creates only the additive AV namespace. Inspect the
   new active version/migration tag and verify original namespace UUID, snapshots,
   Workflow registrations and retained histories still match the inventory.
3. Re-run the full PR's production-target **version upload** for the exact reviewed
   head. Require a successful check and inspect the uploaded bundle/bindings;
   uploading does not promote its HTTP code or validate historical execution.
4. Request separate approval for main merge/promotion of that exact PR head only
   after all acceptance gates and historical-client handling are documented.
   Following the automatic deployment, confirm active version/traffic, four
   bindings, v2 tag, both namespace UUIDs, status/WebSocket behavior and retained
   histories. Do not send decisions to unreviewed legacy AV engines.

## Failure and recovery

Stop before promotion on any namespace mismatch, destructive migration, unexpected
engine/journal behavior or stale backup. Preserve both namespaces and all retained
histories. Adding a DO class can restrict rollback across migrations: a switch to
an older Worker version is not a sufficient rollback plan. Prepare a forward-fix
bundle retaining both DO exports/bindings and v1/v2 history, with the approved
safe handler behavior. Validate it on staging before the execution window.

Real media publication additionally requires authenticated reviewer authorization,
revision/destination binding, idempotent publication IDs and private-channel A/V
acceptance. Existing simulated media checks do not satisfy those requirements.
