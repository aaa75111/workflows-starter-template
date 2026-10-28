import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertBootstrapTarget, bootstrapAccount, bootstrapEnvironment, readBootstrapSource } from "./check-bootstrap.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function fixtureConfig() {
	return {
		account_id: bootstrapAccount, name: "workflows-starter-template-bootstrap-staging",
		main: "worker/index.ts", compatibility_date: "2025-10-08",
		workers_dev: false, preview_urls: false, routes: [],
		workflows: [{ name: "shion-av-bootstrap-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" }],
		durable_objects: { bindings: [{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" }] },
		migrations: [{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] }],
	};
}

function main(args) {
	assert.equal(args.length, 1, "Usage: node scripts/prepare-bootstrap-fixture.mjs FULL_SOURCE_SHA (dry-run only)");
	const baseline = JSON.parse(readFileSync(resolve(root, "scripts/bootstrap-baseline.json"), "utf8"));
	const source = readBootstrapSource(args[0], baseline.commit);
	const config = fixtureConfig();
	assertBootstrapTarget(config, "staging", "v1");
	const parent = resolve(root, ".wrangler");
	mkdirSync(parent, { recursive: true });
	const artifact = mkdtempSync(join(parent, "bootstrap-v1-fixture-"));
	const sourceHashes = {};
	for (const path of ["worker/index.ts", "worker/workflow.ts", "worker/durable-object.ts"]) {
		const bytes = execFileSync("git", ["show", `${baseline.commit}:${path}`], { cwd: root });
		assert.equal(digest(bytes), baseline.files[path], `Unexpected fixture source: ${path}`);
		const destination = resolve(artifact, path);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, bytes);
		sourceHashes[path] = digest(bytes);
	}
	const configPath = resolve(artifact, "wrangler.json");
	writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
	const env = bootstrapEnvironment("production");
	execFileSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy",
		"--config", configPath, "--dry-run", "--outdir", resolve(artifact, "bundle")],
		{ cwd: artifact, env, stdio: "inherit" });
	assert.deepEqual(readBootstrapSource(args[0], baseline.commit), source, "Source changed while preparing fixture");
	const files = {};
	function hashDirectory(dir) {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) hashDirectory(path);
			else files[relative(artifact, path).replaceAll("\\", "/")] = digest(readFileSync(path));
		}
	}
	hashDirectory(artifact);
	const manifest = { sourceCommit: source.sourceCommit, fixtureSourceCommit: baseline.commit,
		accountId: bootstrapAccount, target: config.name, phase: "v1", sourceHashes, files,
		artifactHash: digest(JSON.stringify(files)), deploymentPerformed: false };
	writeFileSync(resolve(artifact, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
	console.log(`Prepared private v1 fixture: ${artifact}; artifact hash ${manifest.artifactHash}; no deployment performed.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
