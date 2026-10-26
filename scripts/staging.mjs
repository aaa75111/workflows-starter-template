import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workerName = "workflows-starter-template-staging";

// Validate the emitted Vite config, not only the source environment declaration.
// A stale production build or a cross-script binding must never reach deploy.
export function assertStagingTarget(config) {
	assert.equal(config.name, workerName, "Refusing a non-staging Worker target");
	assert.equal(config.workers_dev, false, "Staging workers.dev must stay disabled");
	assert.equal(config.preview_urls, false, "Staging version URLs must stay disabled");
	assert.deepEqual(config.routes, [], "Staging must not claim any routes");
	assert.ok(!config.route, "Staging must not claim a production route");
	assert.deepEqual(config.workflows, [
		{ name: "my-workflow-staging", binding: "MY_WORKFLOW", class_name: "MyWorkflow" },
		{ name: "shion-av-content-pipeline-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" },
	]);
	assert.deepEqual(config.durable_objects.bindings, [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
		{ name: "AV_WORKFLOW_STATUS", class_name: "AvWorkflowStatusDO" },
	]);
	assert.deepEqual(config.migrations, [
		{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] },
		{ tag: "v2", new_sqlite_classes: ["AvWorkflowStatusDO"] },
	], "Only the additive v1/v2 migration history is allowed");
}

function main(args) {
	assert.ok(args.length === 1 && ["--dry-run", "--deploy"].includes(args[0]),
		"Use --dry-run or --deploy; no target overrides are accepted");
	const deploy = args[0] === "--deploy";
	if (deploy) {
		assert.match(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", /^[a-f0-9]{32}$/i,
			"Set the intended CLOUDFLARE_ACCOUNT_ID before a real staging deployment");
	}
	// Workers Builds may override the Worker name. Never accept its production
	// override when this script is used from the production project's build job.
	assert.ok(!process.env.WRANGLER_CI_OVERRIDE_NAME ||
		process.env.WRANGLER_CI_OVERRIDE_NAME === workerName,
		"Use a separate staging Worker build integration, not production's name override");
	const env = { ...process.env, CLOUDFLARE_ENV: "staging", WRANGLER_SEND_METRICS: "false" };
	const run = (cli, cliArgs, cliEnv = env) => execFileSync(process.execPath, [resolve(root, cli), ...cliArgs],
		{ cwd: root, env: cliEnv, stdio: "inherit" });
	run("node_modules/typescript/bin/tsc", ["-b"]);
	run("node_modules/vite/bin/vite.js", ["build"]);
	const redirectPath = resolve(root, ".wrangler/deploy/config.json");
	const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
	assert.equal(typeof redirect.configPath, "string", "Missing Vite deployment config");
	assert.equal(redirect.auxiliaryWorkers?.length ?? 0, 0, "Unexpected auxiliary Workers");
	const configPath = resolve(dirname(redirectPath), redirect.configPath);
	assertStagingTarget(JSON.parse(readFileSync(configPath, "utf8")));
	console.log(`Validated isolated target: ${workerName}; mode: ${deploy ? "deploy" : "dry-run"}`);
	// This config is already flattened by Vite. Re-selecting an environment here
	// would reinterpret the emitted config instead of deploying what was checked.
	const deployEnv = { ...env };
	delete deployEnv.CLOUDFLARE_ENV;
	run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", configPath,
		...(deploy ? [] : ["--dry-run"])], deployEnv);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main(process.argv.slice(2));
}
