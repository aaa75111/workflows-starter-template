import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACCOUNT, TARGET, assertStagingTarget } from "./pr20-staging.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const FIXTURES = {
	"legacy-main": { ref: "51d36ce7b9d59da6e50c73407229467c3e4aeda1", files: ["worker/index.ts", "worker/workflow.ts", "worker/durable-object.ts"] },
	"pr18": { ref: "9f9aace4f12d06f6fe7b662a61ad629bec6dda15", files: ["worker/index.ts", "worker/workflow.ts", "worker/durable-object.ts", "worker/approval.ts"] },
};

export function fixtureConfig() {
	return {
		name: TARGET, main: "worker/index.ts", compatibility_date: "2025-10-08",
		workers_dev: false, preview_urls: false, routes: [],
		workflows: [{ name: "shion-av-content-pipeline-pr20-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" }],
		durable_objects: { bindings: [{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" }] },
		migrations: [{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] }],
	};
}

function main(args) {
	assert.ok(args.length === 2 && ["--dry-run", "--deploy"].includes(args[0]) && Object.hasOwn(FIXTURES, args[1]),
		"Use --dry-run|--deploy legacy-main|pr18; no target overrides");
	if (args[0] === "--deploy") assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
	assert.ok(!process.env.WRANGLER_CI_OVERRIDE_NAME || process.env.WRANGLER_CI_OVERRIDE_NAME === TARGET);
	const fixture = FIXTURES[args[1]], config = fixtureConfig();
	assertStagingTarget(config);
	const artifact = mkdtempSync(resolve(tmpdir(), "pr20-private-fixture-"));
	const manifest = { profile: args[1], sourceCommit: fixture.ref, target: TARGET, files: {} };
	for (const path of fixture.files) {
		const content = execFileSync("git", ["show", fixture.ref + ":" + path], { cwd: root });
		const destination = resolve(artifact, path);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, content);
		manifest.files[path] = createHash("sha256").update(content).digest("hex");
	}
	writeFileSync(resolve(artifact, "manifest.json"), JSON.stringify(manifest, null, 2));
	const configPath = resolve(artifact, "wrangler.json");
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log(JSON.stringify({ artifact, ...manifest }));
	const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
	delete env.CLOUDFLARE_ENV;
	execFileSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy",
		"--config", configPath, ...(args[0] === "--dry-run" ? ["--dry-run"] : [])],
		{ cwd: artifact, env, stdio: "inherit" });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
