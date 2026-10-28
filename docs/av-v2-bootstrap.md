# AV v2 namespace bootstrap — private rehearsal passed; production pending

PR #16 cannot upload a production-target version while `AvWorkflowStatusDO` is
an unapplied migration. This standalone change adds the new class, its binding,
and additive v2 history to exact main
`51d36ce7b9d59da6e50c73407229467c3e4aeda1`. It leaves that main's HTTP handler,
Workflow, original DO, UI, dependencies and v1 unchanged. The new class responds
503 without reading or writing storage; no route or Workflow uses it yet.

This is only the infrastructure prerequisite for PR #16. It does **not** activate
the approval fixes in PR #18/#20 or the isolation/compatibility fixes in #16/#21.
Those changes remain separate review and release decisions. If main or the live
deployment advances (especially to #18/#20), regenerate this bootstrap from the
new exact baseline and repeat acceptance. Deploying this old baseline after a
hotfix would revert that hotfix.

## Latest acceptance on 2026-10-28

[Detailed acceptance record](av-v2-bootstrap-acceptance-2026-10-28.md): the
private bootstrap Worker was rehearsed from a frozen v1 fixture to v2 at source
`b58fefd3fdff0404527b596c29553e53ee70fbb7`, followed by compatible forward
redeployment. Original namespace identity, completed/waiting legacy engine
journals and versions, application snapshots, WebSocket reconnects and later
legacy continuation passed. Public routes, workers.dev and previews remain off.

Production remains on `5a3defac-dbae-4b5d-a925-4c2045c81afc`, 100%, tag `v1`;
no production migration or main merge occurred. Private success does not remove
the production migration prerequisite or accept the full #16/#21 application.
Application snapshots are not full SQLite/PITR or Workflow engine backups.

## Confirmed failure on 2026-10-26

The authenticated dashboard was read for [Cloudflare build a455f048](https://dash.cloudflare.com/9bf1848f94dd5acd6989dfb705adba37/workers/services/view/workflows-starter-template/production/builds/a455f048-8f39-4a55-99fa-067ae5f03ed2),
head `8f0d117ff480e9dec0a18b5d42cb7b73a6c70946`:

- 12:26:45.523 Taipei: build command succeeded.
- 12:26:45.674: `npx wrangler versions upload` began.
- 12:26:49.671: pending Durable Object migration; Wrangler requires a deploy
  before a version upload can succeed.
- The deployment list still showed `5a3defac` serving 100% from main `51d36ce`.
- [GitHub Actions 40269080928](https://github.com/aaa75111/workflows-starter-template/actions/runs/40269080928)
  succeeded for the PR #16 head. This is not a quota failure in the observed run.

Cloudflare's [deployment-management documentation](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)
requires class lifecycle changes to use `wrangler deploy`. Its
[Durable Object deployment guidance](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/)
recommends separating lifecycle changes from other application changes.

## Local preparation

Use Node 24 and the committed lockfile. On Windows use `npm.cmd`.

```sh
npm ci --progress=false
npm audit --audit-level=low
npm run verify
node --test scripts/bootstrap-checks.mjs
# Refresh the baseline reference before preparation; this does not deploy.
git fetch origin main
# Supply the full source SHA selected for this review.
node scripts/check-bootstrap.mjs production <FULL_SOURCE_SHA>
node scripts/check-bootstrap.mjs staging <FULL_SOURCE_SHA>
node scripts/prepare-bootstrap-fixture.mjs <FULL_SOURCE_SHA>
```

These preparation scripts **only dry-run**. They require a clean checkout, the
full selected source SHA, the pinned baseline in the refreshed `origin/main`
reference (or this exact source after its eventual merge), and the fixed account.
CI fetches full history so the same checks apply there. The scripts check baseline file hashes (normalizing
Git CRLF text checkouts), builds, inspects Vite's actual emitted config, checks
the two namespaces and unchanged Workflow identity, and writes per-file artifact
hashes, source commit/tree, main reference, account, Node version and build time
to `.wrangler/bootstrap-<target>-manifest.json`. CI runs the same checks.
It rejects public staging URLs, shared production resources and destructive
migrations, alternate DO lifecycle configuration, external bindings and account
or Builds-name overrides. It never changes a cloud account. A locally refreshed
Git reference does not prove the current live Worker matches it; that remains a
separate authenticated check immediately before any deployment.

The v1 fixture copies the exact baseline HTTP handler, Workflow and original DO
from Git, checks each source hash, and packages only the private staging v1
configuration. It has no frontend assets, AV class, production binding, public
route, or shortened timeout. Its source files match the baseline; its isolated
bundle is not the original production bundle. The printed fixture directory
contains a manifest, config and dry-run bundle. Creating it does not run a remote
migration or create an instance.

Initial c52e629 preparation: 6/6 Workers tests, 9/9 guards. Current b58fefd
preparation: 6/6 Workers tests, 25/25 guards, lint, TypeScript,
Vite and both explicit-target dry-runs. The Workers tests exercise existing
approval/HTTP/WebSocket behavior and confirm the new namespace does not modify
original or existing AV storage. They do not prove a remote migration.

Historical artifact-set SHA-256 from c52e629 preparation (hash of the sorted path/hash map):

| Target | SHA-256 |
| --- | --- |
| Production | `15eb7ac83916ee981a92bf0c616d085dd9f61f36b704267621adecf08e4468b0` |
| Private bootstrap staging | `1912255e9edd0984fce70cd40b6ed26c269d60f82112927539cdc4039e9b0113` |

Builds overwrite `dist`; build the selected target again before reviewing or
deploying its artifact. Manifests fingerprint that local build, including its
emitted config and source maps; do not assume identical paths/hashes on another
machine. Keep the matching bytes and fresh manifest together for approval.

## Remote rehearsal and production execution

The MSI device was offline during the initial 2026-10-26 preparation. On
2026-10-28 its existing authorized OAuth session was available and the independent
private v1→v2/forward-redeployment rehearsal passed. See the dated record above.
The target is now v2: **do not redeploy its v1 fixture**. Production migration,
full AV application acceptance and main merge remain pending. The following
steps describe the release sequence; already completed private steps must be
verified against retained evidence instead of replaying a v1 deployment.

1. Reconnect the authorized MSI CLI and confirm account
   `9bf1848f94dd5acd6989dfb705adba37` using normal Wrangler authentication.
2. Recheck exact live version/main, namespace UUIDs, retained engines and direct
   event callers; refresh the application snapshot backup and document its scope.
3. Rehearse v1 to v2 on the independent
   `workflows-starter-template-bootstrap-staging` Worker with Workflow
   `shion-av-bootstrap-staging`. Its public routes, workers.dev and preview URLs
   are disabled. Start with a reviewed v1 fixture from the pinned baseline to
   test retention across an actual migration, not only a fresh v1+v2 creation.
   Use `prepare-bootstrap-fixture.mjs` above to prepare its exact v1 source.
   First inventory the target: stop if it already exists with unreviewed
   namespaces, bindings, history or retained instances. Never apply v1 over v2.
   Do not deploy this inert bootstrap onto #16's already active AV staging.
4. Record namespace identity, original snapshot and retained-engine behavior
   before/after, and validate the later full AV implementation on that isolated
   namespace. Local test eviction/timeout is not real cloud replay evidence.
5. After separate approval naming account, production Worker, fresh artifact hash
   and window, use `wrangler deploy --config <verified emitted config>` for the
   bootstrap. Clear `CLOUDFLARE_ENV` when using the flattened emitted config.
   Keep the default non-production Builds command as `wrangler versions upload`.
6. Verify original namespace/snapshots/history, new AV namespace and v2 tag. Then
   rerun the separately reviewed #16 version upload and check the exact head.
   Main merge/application promotion remains a separate release decision.

Keep both DO exports/bindings and v1/v2 for forward repair. Cloudflare rollbacks
cannot cross a DO lifecycle change; the previous version alone is not a recovery
plan. A JSON application snapshot is not a full SQLite/PITR or engine backup.

This branch stays Draft. Main merges automatically deploy, and this branch
deliberately preserves the old application's behavior until the reviewed fixes
are separately promoted.
