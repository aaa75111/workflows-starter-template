import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const bootstrapAccount = "9bf1848f94dd5acd6989dfb705adba37";
const productionName = "workflows-starter-template";
const stagingName = `${productionName}-bootstrap-staging`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function assertBootstrapTarget(config, target, phase = "v2") {
	assert.ok(["production", "staging"].includes(target), "Unknown bootstrap target");
	assert.ok(phase === "v2" || (phase === "v1" && target === "staging"), "v1 fixtures are staging-only");
	assert.equal(config.account_id, bootstrapAccount, "Unexpected Cloudflare account");
	assert.equal(config.name, target === "staging" ? stagingName : productionName);
	assert.deepEqual(config.workflows, [{
		name: target === "staging" ? "shion-av-bootstrap-staging" : "shion-av-content-pipeline",
		binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow",
	}]);
	assert.deepEqual(config.durable_objects.bindings, [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
		...(phase === "v2" ? [{ name: "AV_WORKFLOW_STATUS", class_name: "AvWorkflowStatusDO" }] : []),
	]);
	assert.deepEqual(config.migrations, [
		{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] },
		...(phase === "v2" ? [{ tag: "v2", new_sqlite_classes: ["AvWorkflowStatusDO"] }] : []),
	]);
	assert.equal(Object.keys(config.exports ?? {}).length, 0, "Unexpected alternate DO lifecycle configuration");
	for (const key of ["services", "kv_namespaces", "r2_buckets", "d1_databases", "dispatch_namespaces"])
		assert.equal(config[key]?.length ?? 0, 0, `Unexpected external binding: ${key}`);
	assert.equal(config.queues?.producers?.length ?? 0, 0);
	assert.equal(config.queues?.consumers?.length ?? 0, 0);
	assert.equal(config.unsafe?.bindings?.length ?? 0, 0);
	assert.equal(config.unsafe?.metadata?.migrations, undefined);
	if (target === "staging") {
		assert.equal(config.workers_dev, false);
		assert.equal(config.preview_urls, false);
		assert.deepEqual(config.routes, []);
		assert.ok(!config.route);
	}
}

export function assertBootstrapSource(source, expectedSource, baselineCommit) {
	assert.match(expectedSource, /^[a-f0-9]{40}$/, "Provide the full reviewed source SHA");
	assert.equal(source.sourceCommit, expectedSource, "Checkout differs from the selected source SHA");
	// A main push after merging this exact bootstrap is also valid; the baseline
	// file checks below still reject any application or dependency change.
	assert.ok([baselineCommit, source.sourceCommit].includes(source.originMain),
		"origin/main changed; regenerate the bootstrap from the new baseline");
	assert.equal(source.baselineIsAncestor, true, "Bootstrap must descend from its baseline");
	assert.equal(source.status, "", "Bootstrap requires a clean checkout, including untracked files");
}

export function readBootstrapSource(expectedSource, baselineCommit) {
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const source = {
		sourceCommit: git("rev-parse", "HEAD"),
		sourceTree: git("rev-parse", "HEAD^{tree}"),
		originMain: git("rev-parse", "refs/remotes/origin/main"),
		status: git("status", "--porcelain=v1", "--untracked-files=normal"),
		baselineIsAncestor: git("merge-base", baselineCommit, "HEAD") === baselineCommit,
	};
	assertBootstrapSource(source, expectedSource, baselineCommit);
	return source;
}

export function bootstrapEnvironment(target, sourceEnv = process.env) {
	assert.ok(["production", "staging"].includes(target), "Unknown bootstrap target");
	assert.ok(!sourceEnv.WRANGLER_CI_OVERRIDE_NAME, "Run outside the production Builds name override");
	if (sourceEnv.CLOUDFLARE_ACCOUNT_ID) assert.equal(sourceEnv.CLOUDFLARE_ACCOUNT_ID, bootstrapAccount);
	const env = { ...sourceEnv, CLOUDFLARE_ACCOUNT_ID: bootstrapAccount, WRANGLER_SEND_METRICS: "false" };
	delete env.CLOUDFLARE_ENV;
	if (target === "staging") env.CLOUDFLARE_ENV = "bootstrap-staging";
	return env;
}

function main(args) {
	assert.ok(args.length === 2 && ["production", "staging"].includes(args[0]),
		"Usage: node scripts/check-bootstrap.mjs production|staging FULL_SOURCE_SHA (dry-run only)");
	const target = args[0];
	const baseline = JSON.parse(readFileSync(resolve(root, "scripts/bootstrap-baseline.json"), "utf8"));
	const source = readBootstrapSource(args[1], baseline.commit);
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
	const env = bootstrapEnvironment(target);
	const run = (script, args, cliEnv = env) => execFileSync(process.execPath, [resolve(root, script), ...args],
		{ cwd: root, env: cliEnv, stdio: "inherit" });
	run("node_modules/typescript/bin/tsc", ["-b"]);
	run("node_modules/vite/bin/vite.js", ["build"]);
	const redirectPath = resolve(root, ".wrangler/deploy/config.json");
	const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
	assert.equal(typeof redirect.configPath, "string");
	assert.equal(redirect.auxiliaryWorkers?.length ?? 0, 0);
	const configPath = resolve(dirname(redirectPath), redirect.configPath);
	assert.ok(relative(resolve(root, "dist"), configPath).replaceAll("\\", "/").startsWith("workflows_starter_template/"),
		"Emitted config must be inside this checkout's Worker artifact");
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
	assert.deepEqual(readBootstrapSource(args[1], baseline.commit), source, "Source changed while building");
	const manifest = { base: baseline.commit, sourceCommit: source.sourceCommit, sourceTree: source.sourceTree,
		originMain: source.originMain, workingTreeClean: true, accountId: bootstrapAccount,
		node: process.version, createdAt: new Date().toISOString(), target,
		config: relative(root, configPath).replaceAll("\\", "/"),
		files, artifactHash: digest(JSON.stringify(files)), deploymentPerformed: false };
	const report = resolve(root, ".wrangler", `bootstrap-${target}-manifest.json`);
	writeFileSync(report, JSON.stringify(manifest, null, 2) + "\n");
	console.log(`Verified ${target} bootstrap; artifact hash ${manifest.artifactHash}; no deployment performed.`);
	console.log(`Manifest: ${report}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
