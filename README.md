# Cloudflare Workflows Starter Template

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/workflows-starter-template)

<!-- dash-content-start -->

A real-time, interactive demonstration of [Cloudflare Workflows](https://developers.cloudflare.com/workflows) with live updates via WebSockets and Durable Objects. This template showcases durable multi-step workflows with time-based delays, event-driven pauses, and real-time status visualization.

<!-- dash-content-end -->

![Cloudflare Workflows Starter Template](assets/template-screenshot.png)

## Getting Started

### Installation

```bash
npm ci
```

### Development

```bash
npm run dev
```

Visit `http://localhost:5173` to see the interactive demo. Use the "Shion AV
content pipeline (preview)" link in the header to switch to a second,
isolated demo workflow (ingest → transcode → editorial approval → publish).
It's simulated end to end (fixed delays, no real media I/O) and runs on its
own Workflow binding, Durable Object, and API routes (`/api/av/workflow/*`,
`/ws/av`) — it never shares instance IDs or state with the default demo
above, and does not replace the default `MY_WORKFLOW`/`WORKFLOW_STATUS`
bindings. See `worker/shion-pipeline-workflow.ts` for details.

### Verification and AI agents

Use Node.js 24 (see `.nvmrc`). After installing dependencies, run:

```bash
npm run verify
```

This runs lint, the production build, local Workers tests, and a deployment dry
run without publishing or requiring a Cloudflare token. Codex and ChatGPT Work
can read [AGENTS.md](AGENTS.md); Claude Code and Shion agents can read
[CLAUDE.md](CLAUDE.md), which imports the same instructions. In a chat without a
local checkout, ask the agent to read these files through its GitHub connection.

On Windows, `start-agent.cmd -Agent grok` starts the installed Grok CLI in this
checkout. The launcher also accepts `codex`, `claude`, `gemini`, and `copilot`;
add `-Check` to verify command discovery without starting a model session.

The test integration uses `@cloudflare/vitest-plugin` with Vitest 5. Upgrade these
packages together after checking peer dependencies, and commit the npm lockfile.
The old direct runner/snapshot pins are no longer needed.

Pull requests run a clean install, `npm audit --audit-level=low` (including dev
dependencies), and `npm run verify` in GitHub Actions. The workflow uses read-only
repository permissions and does not deploy. Run both commands locally after
changing dependencies. An unavailable audit service is a failed check, not a
clean scan.

Use the committed lockfile with `npm ci`. Keep Vitest's UI/API and the Vite dev
server private to your machine; avoid exposing test APIs with `--api.host` or
enabling remote write/execute permissions. Security fixes must reach the default
branch before Dependabot can reassess the repository's open alerts.

### Deployment

PR #16 introduces a pending Durable Object migration. Read
[deployment acceptance](docs/deployment-acceptance.md) before promoting it.
For an isolated, non-deploying rehearsal run `npm run check:staging`. The
separate `npm run deploy:staging` command requires an explicitly selected
authorized account and keeps public URLs disabled. `npm run deploy` below
targets production; it is not a workaround for a failing PR version upload.

```bash
npm run deploy
```

## Learn More

- [Cloudflare Workflows Documentation](https://developers.cloudflare.com/workflows)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects)
- [Workers Documentation](https://developers.cloudflare.com/workers)

## Editorial safety and existing instances

The AV demo accepts only an object containing the boolean `approved: true`
(and a string `comment`, when provided). Rejection ends the Workflow engine in
`errored` with `APPROVAL_REJECTED` and the AV WebSocket in `rejected`. Invalid
payloads, review timeouts and other failures end in `error`. No such outcome
executes `publish to channels`. Invalid HTTP JSON is rejected with 400 before an
event is sent; the pending workflow remains subject to its normal review timeout.

The first matching event is final. Late decisions return 409 for a terminated
instance. Progress and terminal snapshots are persisted atomically; notification
failure stops the pipeline instead of silently continuing to publish.

| Existing interface | Behavior after this repair |
| --- | --- |
| `MY_WORKFLOW`, `my-workflow`, `MyWorkflow` | Original demo identity retained |
| `WORKFLOW_STATUS`, `WorkflowStatusDO`, migration `v1` | Original namespace and data retained |
| `/api/workflow/start` | Original generic demo; new AV callers use `/api/av/workflow/start` |
| Generic old status/event IDs and `/ws` | Original routing and `workflow_update` messages |
| PR #6 AV IDs in old status routes | Recognized by their stored four AV steps and inspected through SHION |
| PR #6 AV decisions on either event route | 409 `LEGACY_INSTANCE_REQUIRES_REVIEW`; no event forwarded, instance retained |
| PR #6 AV IDs on `/ws` | Live original DO and `workflow_update` envelope; `/ws/av` refuses these IDs with 409 |
| `/api/av/workflow/*`, `/ws/av` | Isolated AV workflow/status namespace and `av_workflow_update` messages |
| PR #6 AV snapshot import | Non-destructive one-time copy; never presented as the live state of an old engine |
| Mixed or unknown AV snapshots | Refused for manual review; never silently converted or deleted |

Instances created directly through the SHION binding without an old snapshot
must use the explicit AV routes. Existing external AV start callers from PR #6
must change to `/api/av/workflow/start`. Cloud staging replay found that historical
AV runs could still publish after a false or malformed decision after deployment.
Their decisions are therefore blocked pending a reviewed recovery plan. A snapshot
copy does not upgrade an execution history. Direct binding/API event senders must
also be inventoried before release. See the [cloud rehearsal](docs/staging-rehearsal-2026-10-24.md).

All ingest, transcode and publish operations remain simulated. See
[deployment acceptance](docs/deployment-acceptance.md) for the remaining
production and real-media checks.
