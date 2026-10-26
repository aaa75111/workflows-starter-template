import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const productionName = "workflows-starter-template";
const stagingName = `${productionName}-bootstrap-staging`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function assertBootstrapTarget(config, target) {
	assert.ok(["production", "staging"].includes(target), "Unknown bootstrap target");
	assert.equal(config.name, target === "staging" ? stagingName : productionName);
	assert.deepEqual(config.workflows, [{
		name: target === "staging" ? "shion-av-bootstrap-staging" : "shion-av-content-pipeline",
		binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow",
	}]);
	assert.deepEqual(config.durable_objects.bindings, [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
		{ name: "AV_WORKFLOW_STATUS", class_name: "AvWorkflowStatusDO" },
	]);
	assert.deepEqual(config.migrations, [
		{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] },
		{ tag: "v2", new_sqlite_classes: ["AvWorkflowStatusDO"] },
	]);
	if (target === "staging") {
		assert.equal(config.workers_dev, false);
		assert.equal(config.preview_urls, false);
		assert.deepEqual(config.routes, []);
		assert.ok(!config.route);
	}
}

function main(args) {
	assert.ok(args.length === 1 && ["production", "staging"].includes(args[0]),
		"Usage: node scripts/check-bootstrap.mjs production|staging (dry-run only)");
	const target = args[0];
	const baseline = JSON.parse(readFileSync(resolve(root, "scripts/bootstrap-baseline.json"), "utf8"));
	for (const [path, hash] of Object.entries(baseline.files)) {
		let bytes = readFileSync(resolve(root, path));
		// Git may check text out as CRLF on the authorized Windows workstation.
		if (baseline.textFiles.includes(path)) bytes = Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
		if (path === "worker/index.ts") {
			const addition = 'export { AvWorkflowStatusDO } from "./av-bootstrap-object";\n';
			assert.equal(bytes.toString().split(addition).length, 2, "Expected exactly one added export");
			bytes = Buffer.from(bytes.toString().replace(addition, ""));
		}
		assert.equal(digest(bytes), hash, `Unexpected change to baseline file: ${path}`);
	}
	const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
	assert.ok(!env.WRANGLER_CI_OVERRIDE_NAME, "Run this standalone check outside the production Builds name override");
	delete env.CLOUDFLARE_ENV;
	if (target === "staging") env.CLOUDFLARE_ENV = "bootstrap-staging";
	const run = (script, args, cliEnv = env) => execFileSync(process.execPath, [resolve(root, script), ...args],
		{ cwd: root, env: cliEnv, stdio: "inherit" });
	run("node_modules/typescript/bin/tsc", ["-b"]);
	run("node_modules/vite/bin/vite.js", ["build"]);
	const redirectPath = resolve(root, ".wrangler/deploy/config.json");
	const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
	assert.equal(typeof redirect.configPath, "string");
	assert.equal(redirect.auxiliaryWorkers?.length ?? 0, 0);
	const configPath = resolve(dirname(redirectPath), redirect.configPath);
	assertBootstrapTarget(JSON.parse(readFileSync(configPath, "utf8")), target);
	const deployEnv = { ...env };
	delete deployEnv.CLOUDFLARE_ENV;
	run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", configPath, "--dry-run"], deployEnv);
	const files = {};
	function hashDirectory(dir) {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) hashDirectory(path);
			else files[relative(root, path).replaceAll("\\", "/")] = digest(readFileSync(path));
		}
	}
	hashDirectory(resolve(root, "dist"));
	const manifest = { base: baseline.commit, target, config: relative(root, configPath).replaceAll("\\", "/"),
		files, artifactHash: digest(JSON.stringify(files)), deploymentPerformed: false };
	const report = resolve(root, ".wrangler", `bootstrap-${target}-manifest.json`);
	writeFileSync(report, JSON.stringify(manifest, null, 2) + "\n");
	console.log(`Verified ${target} bootstrap; artifact hash ${manifest.artifactHash}; no deployment performed.`);
	console.log(`Manifest: ${report}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
