import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertStagingTarget } from "./staging.mjs";

const isolated = () => ({
	name: "workflows-starter-template-staging",
	workers_dev: false,
	preview_urls: false,
	routes: [],
	workflows: [
		{ name: "my-workflow-staging", binding: "MY_WORKFLOW", class_name: "MyWorkflow" },
		{ name: "shion-av-content-pipeline-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" },
	],
	durable_objects: { bindings: [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
		{ name: "AV_WORKFLOW_STATUS", class_name: "AvWorkflowStatusDO" },
	] },
	migrations: [
		{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] },
		{ tag: "v2", new_sqlite_classes: ["AvWorkflowStatusDO"] },
	],
});

test("accepts the isolated migration rehearsal", () => {
	assert.doesNotThrow(() => assertStagingTarget(isolated()));
});

for (const [name, mutate] of [
	["stale production build", c => { c.name = "workflows-starter-template"; }],
	["production Workflow", c => { c.workflows[0].name = "my-workflow"; }],
	["production DO namespace", c => { c.durable_objects.bindings[0].script_name = "workflows-starter-template"; }],
	["public workers.dev", c => { c.workers_dev = true; }],
	["public version URL", c => { c.preview_urls = true; }],
	["production route", c => { c.routes = ["example.com/*"]; }],
	["singular production route", c => { c.route = "example.com/*"; }],
	["destructive migration", c => { c.migrations[1] = { tag: "v2", deleted_classes: ["WorkflowStatusDO"] }; }],
]) {
	test(`blocks ${name} before a Cloudflare mutation`, () => {
		const config = isolated();
		mutate(config);
		assert.throws(() => assertStagingTarget(config));
	});
}

test("rejects target override arguments before building or deploying", () => {
	const script = fileURLToPath(new URL("./staging.mjs", import.meta.url));
	assert.throws(() => execFileSync(process.execPath, [script, "--deploy", "--name", "workflows-starter-template"],
		{ stdio: "pipe" }), /no target overrides/);
});
