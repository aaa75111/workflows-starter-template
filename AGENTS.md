# Working on this repository

These instructions apply to Codex, ChatGPT Work, Claude Code, Grok, and Shion agents
working on `aaa75111/workflows-starter-template`.

Use Traditional Chinese for user-facing progress and results. On Windows, use
`npm.cmd` if PowerShell selects a blocked `npm.ps1`. From the repository root,
`start-agent.cmd -Agent claude` (or `codex`, `gemini`, `copilot`, `grok`, `shell`) opens
the selected installed tool in this checkout. Use separate worktrees for
simultaneous agents; inspect `git status --short --branch` before editing.

## Setup and verification

- Use Node.js 24 (`.nvmrc`) and npm. Install the committed dependency graph with
  `npm ci --progress=false`.
- Run `npm run verify` after dependency or application changes. It runs lint,
  the TypeScript/Vite build, the existing Workers tests, and a Wrangler deployment
  dry run. This command does not deploy and requires no production credentials.
- `npm run dev` starts the local app. `npm test` builds assets before running the
  Workflow tests inside the local Workers runtime.
- Report the branch, commit, checks run, and any failed or unavailable checks.

## Dependency changes

- Keep `vitest` compatible with `@cloudflare/vitest-plugin` peer dependencies.
  The migration uses Vitest 5 and the `cloudflareTest()` plugin API.
- Do not reintroduce `@cloudflare/vitest-pool-workers`, its removed `/config`
  import, or the old direct `@vitest/runner` and `@vitest/snapshot` 3.x pins.
- Update `package.json` and `package-lock.json` together using npm. Verify with a
  clean `npm ci`; do not bypass peer conflicts with `--force` or `--legacy-peer-deps`.

## Cloudflare and handoff

- The Worker name is `workflows-starter-template`; bindings are `MY_WORKFLOW`
  and `WORKFLOW_STATUS`. Keep tests local and preserve these binding names.
- Cloudflare Builds runs `npm run build`. Non-production branches use
  `npx wrangler versions upload`; uploading a version does not promote it to
  production traffic. `npm run deploy` performs a production deployment.
- Pending Durable Object migrations cannot be applied by version upload. Use
  `npm run check:staging` for the isolated target's guard tests/build/dry run.
  `npm run deploy:staging` requires an explicitly selected authorized account;
  it targets independent resource names with public URLs disabled. Do not change
  production's non-production version command to an unqualified deploy. Read
  `docs/deployment-acceptance.md` before merging (main auto-deploys).
- Use the authenticated GitHub connection to update the requested PR branch and
  inspect Cloudflare's check for that exact commit. Use the existing authenticated
  Cloudflare connection or browser session when build details are needed.
- Keep credentials in the agent environment or the platform's secret store, never
  in repository files or handoff messages. Project instructions do not grant account
  access; each agent needs its own authorized connection.
