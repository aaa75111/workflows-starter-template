# PR #16 Cloudflare build diagnosis — 2026-10-24

## Evidence inspected

- PR #16: open, non-draft, mergeable; inspected head
  `f97cab03e7481d84d1305d25ed559ec37cd2b071` on
  `claude/shion-av-pipeline-isolated`.
- [Actions run 40064218872](https://github.com/aaa75111/workflows-starter-template/actions/runs/40064218872):
  success; job logs show locked install, audit with zero vulnerabilities,
  lint/build, 25 passing Workers tests and four-binding deployment dry-run.
  Actions checks out the PR merge ref `b37fd821ab1c7166d11c56e3d1caa5e0d1f9c047`,
  combining the inspected head with main `51d36ce7b9d59da6e50c73407229467c3e4aeda1`.
- [Cloudflare build 52fe742a](https://dash.cloudflare.com/9bf1848f94dd5acd6989dfb705adba37/workers/services/view/workflows-starter-template/production/builds/52fe742a-d61a-4e1f-8eac-297a9b94efc5):
  failed for that head. The authenticated dashboard and rendered deploy-stage
  logs were read directly, rather than inferring the cause from PR discussion.

## Actual failure (Taipei, UTC+8)

| Time | Dashboard log |
| --- | --- |
| 12:55:03.977 | Build environment initialization starts |
| 12:55:31.760 | `npm run build` starts |
| 12:55:41.047 | Build command succeeds |
| 12:55:41.279 | `npx wrangler versions upload` starts |
| 12:55:42.864 | Wrangler 4.152.0; uses Vite's emitted configuration |
| 12:55:44.069 | Pending Durable Object migration cannot be applied by version upload; `wrangler deploy` is required |
| 12:55:44.153 | Deploy command fails |

The dashboard reports about 42 seconds total. GitHub check `120784075161` reports
identical `started_at` / `completed_at` values (`04:55:46Z`); these are insufficient
to conclude that Cloudflare rejected the build in zero seconds.

| Candidate cause | Finding for this run |
| --- | --- |
| Build quota / concurrency cap | No limit error in the observed run; installation and build completed. Account-wide remaining quota was not audited. |
| Account / Git integration | Checkout, install, build and authenticated Wrangler inspection progressed. No authentication error was shown; this does not certify every future deploy permission. |
| Workflow binding | Not the reported failure. Current live settings show `SHION_WORKFLOW` and `WORKFLOW_STATUS`; proposed packaging includes restored `MY_WORKFLOW` plus new `AV_WORKFLOW_STATUS`. Remote reconciliation remains an acceptance item. |
| Durable Object migration | **Confirmed immediate blocker.** Source retains v1 and adds v2 for `AvWorkflowStatusDO`; version upload cannot apply the pending migration. |
| Application code | Cloud build succeeded; 25 local-runtime tests and audit passed in CI. These do not prove live replay, routing or real media publication. |

## Read-only live inventory

The production deployment view showed active version prefix `5a3defac` (main/PR
#17), not PR #16. Worker settings showed `WORKFLOW_STATUS` pointing to
`workflows-starter-template_WorkflowStatusDO` and `SHION_WORKFLOW` pointing to
`shion-av-content-pipeline`; the proposed `AV_WORKFLOW_STATUS` was not present.
No exact DO namespace UUID, stored snapshots or remote migration tag were exported.

The account's Workflows list contained `my-workflow` and
`shion-av-content-pipeline`, both displaying zero current inactive/running/ended/
errored instances. The dashboard's configured retention was three days; zero in
this view is not evidence that historical instances, clients or snapshots never
existed. Neither Workflow was deleted, restarted, renamed or sent an event.

Build settings: main is the production branch; build is `npm run build`,
production deploy is `npm run deploy`, non-production version command is
`npx wrangler versions upload`. Replacing the latter with an unqualified
`wrangler deploy` would deploy the PR to the production Worker and is not the fix.

## Repair and release boundary

The added staging environment and guarded commands provide a way to apply the
same additive migrations to a separate Worker and independent Workflow names,
without exposing URLs or attaching production namespaces. Guards inspect Vite's
actual output and reject production targets, shared Workflow/DO resources,
public routes and destructive migration changes. Existing application code,
approval gates, original v1/v2 history and undici/zod overrides are retained.

This preparatory repair does not claim that a remote migration was performed.
Record actual staging deployment/version IDs, namespace UUIDs, migration history
and event/replay evidence before production promotion. For an existing Worker,
keep a forward-repair plan: adding a DO class can restrict rollback across the
migration, so an old Worker version alone is not a complete rollback plan.

The latest Bugbot check for `f97cab03` eventually completed at `05:07:25Z` with
no issues found. The approval agent's earlier review at `05:03:44Z` still says
not approved because its wait expired. A successful agent execution check is
not an approval. Codex's earlier failed review is not a review of the final head.

## Staging-support verification

With Node.js 24.19.0 and the committed dependency graph:

- Clean `npm ci --progress=false` succeeded; `npm audit --audit-level=low`
  reported zero vulnerabilities.
- `npm run verify` passed lint, TypeScript/Vite, all 25 Workers tests and the
  default four-binding deployment dry-run. Expected negative-case runtime logs
  did not change the passing assertions or exit status.
- `npm run check:staging` passed all ten guard tests, rebuilt the staging Vite
  output, checked isolated resource names and completed Wrangler's four-binding
  dry-run with exit code zero. The flattened config is deployed without
  reinterpreting `CLOUDFLARE_ENV` a second time.
- `git diff --check` passed. Application workflow/approval code and the locked
  undici/zod security overrides were not changed.

The development checkout's `wrangler whoami` reported no authenticated account.
The authorized browser session provided dashboard evidence, not a transferable
CLI credential. No real staging or production deployment, migration, snapshot
backup or historical replay was performed in these checks. Do not substitute a
temporary Cloudflare account, extract browser credentials, or mark the original
Cloudflare deployment failure as resolved based on these dry-runs.

See [deployment acceptance](deployment-acceptance.md) for the remaining gates.

References:

- [Cloudflare: pending DO migrations and gradual deployment](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
- [Cloudflare: selecting the Vite environment at build time](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)
