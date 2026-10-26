import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBootstrapTarget } from "./check-bootstrap.mjs";

const config = () => ({
	name: "workflows-starter-template-bootstrap-staging",
	workers_dev: false, preview_urls: false, routes: [],
	workflows: [{ name: "shion-av-bootstrap-staging", binding: "SHION_WORKFLOW", class_name: "ShionPipelineWorkflow" }],
	durable_objects: { bindings: [
		{ name: "WORKFLOW_STATUS", class_name: "WorkflowStatusDO" },
		{ name: "AV_WORKFLOW_STATUS", class_name: "AvWorkflowStatusDO" },
	] },
	migrations: [{ tag: "v1", new_sqlite_classes: ["WorkflowStatusDO"] },
		{ tag: "v2", new_sqlite_classes: ["AvWorkflowStatusDO"] }],
});

test("accepts additive isolated staging and the explicitly selected production target", () => {
	assert.doesNotThrow(() => assertBootstrapTarget(config(), "staging"));
	const prod = config();
	prod.name = "workflows-starter-template";
	prod.workflows[0].name = "shion-av-content-pipeline";
	assert.doesNotThrow(() => assertBootstrapTarget(prod, "production"));
});

for (const [name, mutate] of [
	["production Worker in staging", c => { c.name = "workflows-starter-template"; }],
	["production Workflow in staging", c => { c.workflows[0].name = "shion-av-content-pipeline"; }],
	["shared production namespace", c => { c.durable_objects.bindings[0].script_name = "workflows-starter-template"; }],
	["public staging URL", c => { c.workers_dev = true; }],
	["public preview", c => { c.preview_urls = true; }],
	["public route", c => { c.routes = ["example.com/*"]; }],
	["deleted old namespace", c => { c.migrations[1] = { tag: "v2", deleted_classes: ["WorkflowStatusDO"] }; }],
	["renamed original binding", c => { c.durable_objects.bindings[0].name = "RENAMED"; }],
]) {
	test(`rejects ${name}`, () => {
		const bad = config(); mutate(bad);
		assert.throws(() => assertBootstrapTarget(bad, "staging"));
	});
}
