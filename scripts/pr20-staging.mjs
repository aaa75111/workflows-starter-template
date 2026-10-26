import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGET = "workflows-starter-template-pr20-staging";
export const ACCOUNT = "9bf1848f94dd5acd6989dfb705adba37";
const root = fileURLToPath(new URL("../", import.meta.url));

export function assertStagingTarget(config) {
	assert.equal(config.name, TARGET, "Refusing a non-PR20-staging target");
	assert.equal(config.workers_dev, false);
	assert.equal(config.preview_urls, false);
	assert.deepEqual(config.routes, []);
	assert.ok(!config.route);
	assert.deepEqual(config.workflows, [
		{ name: "shion-av-content-pipeline-pr20-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" },
	]);
	assert.deepEqual(config.durable_objects.bindings, [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
	]);
	assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] }]);
	if (config.account_id) assert.equal(config.account_id, ACCOUNT);
	for (const key of ["services", "kv_namespaces", "r2_buckets", "d1_databases", "dispatch_namespaces"])
		assert.equal(config[key]?.length ?? 0, 0, "Unexpected external binding: " + key);
	assert.equal(config.queues?.producers?.length ?? 0, 0);
	assert.equal(config.queues?.consumers?.length ?? 0, 0);
}

export function validateArgs(args) {
	assert.ok((args.length === 1 && args[0] === "--dry-run") ||
		(args.length === 2 && args[0] === "--deploy" && /^[a-f0-9]{40}$/.test(args[1])),
		"Use --dry-run or --deploy EXACT_HEAD_SHA; no target overrides");
	return args[0] === "--deploy";
}

function main(args) {
	const deploy = validateArgs(args);
	if (deploy) {
		assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT, "Select the authorized staging account");
		const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
		assert.equal(git("rev-parse", "HEAD"), args[1], "Checkout differs from the reviewed artifact");
		assert.equal(git("status", "--porcelain"), "", "Deployment requires a clean checkout");
	}
	assert.ok(!process.env.WRANGLER_CI_OVERRIDE_NAME || process.env.WRANGLER_CI_OVERRIDE_NAME === TARGET,
		"Production build name overrides are forbidden");
	const env = { ...process.env, CLOUDFLARE_ENV: "pr20_staging", WRANGLER_SEND_METRICS: "false" };
	const run = (cli, args, cliEnv = env) => execFileSync(process.execPath, [resolve(root, cli), ...args], { cwd: root, env: cliEnv, stdio: "inherit" });
	run("node_modules/typescript/bin/tsc", ["-b"]);
	run("node_modules/vite/bin/vite.js", ["build"]);
	const redirectPath = resolve(root, ".wrangler/deploy/config.json");
	const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
	assert.equal(typeof redirect.configPath, "string");
	assert.equal(redirect.auxiliaryWorkers?.length ?? 0, 0);
	const configPath = resolve(dirname(redirectPath), redirect.configPath);
	assertStagingTarget(JSON.parse(readFileSync(configPath, "utf8")));
	console.log("Validated private target: " + TARGET + "; mode: " + (deploy ? "deploy" : "dry-run"));
	const deployEnv = { ...env };
	delete deployEnv.CLOUDFLARE_ENV;
	run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", configPath, ...(deploy ? [] : ["--dry-run"])], deployEnv);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
