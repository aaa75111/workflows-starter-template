# Shion AV Content Pipeline

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/workflows-starter-template)

<!-- dash-content-start -->

A real-time, interactive demonstration of [Cloudflare Workflows](https://developers.cloudflare.com/workflows) modeling an audio/video content pipeline, with live updates via WebSockets and Durable Objects. The workflow ingests a raw AV upload, transcodes and normalizes it, pauses for editorial approval, and finally publishes it to channels — showcasing durable multi-step execution with time-based delays, event-driven pauses, and real-time status visualization.

<!-- dash-content-end -->

![Shion AV Content Pipeline](assets/template-screenshot.png)

## Getting Started

### Installation

```bash
npm ci
```

### Development

```bash
npm run dev
```

Visit `http://localhost:5173` to see the interactive demo.

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

```bash
npm run deploy
```

## Learn More

- [Cloudflare Workflows Documentation](https://developers.cloudflare.com/workflows)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects)
- [Workers Documentation](https://developers.cloudflare.com/workers)
