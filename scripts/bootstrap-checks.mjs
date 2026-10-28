import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBootstrapTarget, assertBootstrapSource, bootstrapAccount, bootstrapEnvironment } from "./check-bootstrap.mjs";
import { fixtureConfig } from "./prepare-bootstrap-fixture.mjs";

const config = () => ({
	account_id: bootstrapAccount,
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
	["different account", c => { c.account_id = "0".repeat(32); }],
	["unselected account", c => { delete c.account_id; }],
	["alternate lifecycle deletion", c => { c.exports = { WorkflowStatusDO: { type: "durable-object", state: "deleted" } }; }],
	["external service binding", c => { c.services = [{ binding: "OTHER", service: "workflows-starter-template" }]; }],
	["unexpected queue consumer", c => { c.queues = { consumers: [{ queue: "production" }] }; }],
	["unsafe foreign binding", c => { c.unsafe = { bindings: [{ name: "OTHER", type: "durable_object_namespace" }] }; }],
	["unsafe migration override", c => { c.unsafe = { metadata: { migrations: { deleted_classes: ["WorkflowStatusDO"] } } }; }],
]) {
	test(`rejects ${name}`, () => {
		const bad = config(); mutate(bad);
		assert.throws(() => assertBootstrapTarget(bad, "staging"));
	});
}

test("v1 rehearsal fixture uses only the original namespace on the private target", () => {
	assert.doesNotThrow(() => assertBootstrapTarget(fixtureConfig(), "staging", "v1"));
	assert.throws(() => assertBootstrapTarget(fixtureConfig(), "production", "v1"));
	assert.throws(() => assertBootstrapTarget(fixtureConfig(), "staging"));
	const wrong = fixtureConfig();
	wrong.durable_objects.bindings[0].script_name = "workflows-starter-template";
	assert.throws(() => assertBootstrapTarget(wrong, "staging", "v1"));
});

const sourceSha = "c52e629c360f49b9b9b678d00b29bbc922186882";
const baseSha = "51d36ce7b9d59da6e50c73407229467c3e4aeda1";
const source = () => ({ sourceCommit: sourceSha, originMain: baseSha, baselineIsAncestor: true, status: "" });

test("accepts a clean exact source on the pinned main baseline", () => {
	assert.doesNotThrow(() => assertBootstrapSource(source(), sourceSha, baseSha));
	assert.doesNotThrow(() => assertBootstrapSource({ ...source(), originMain: sourceSha }, sourceSha, baseSha));
});

for (const [name, mutate] of [
	["another source SHA", c => { c.sourceCommit = "0".repeat(40); }],
	["advanced main", c => { c.originMain = "0".repeat(40); }],
	["unrelated baseline", c => { c.baselineIsAncestor = false; }],
	["modified tracked file", c => { c.status = " M worker/workflow.ts"; }],
	["untracked source file", c => { c.status = "?? worker/unreviewed.ts"; }],
]) {
	test(`rejects source with ${name}`, () => {
		const bad = source(); mutate(bad);
		assert.throws(() => assertBootstrapSource(bad, sourceSha, baseSha));
	});
}

test("rejects abbreviated source SHA", () => {
	assert.throws(() => assertBootstrapSource(source(), sourceSha.slice(0, 7), baseSha));
});

test("pins account and environment and rejects conflicting deployment overrides", () => {
	assert.equal(bootstrapEnvironment("production", { CLOUDFLARE_ENV: "bootstrap-staging" }).CLOUDFLARE_ENV, undefined);
	const staging = bootstrapEnvironment("staging", { CLOUDFLARE_ENV: "production" });
	assert.equal(staging.CLOUDFLARE_ENV, "bootstrap-staging");
	assert.equal(staging.CLOUDFLARE_ACCOUNT_ID, bootstrapAccount);
	assert.throws(() => bootstrapEnvironment("staging", { CLOUDFLARE_ACCOUNT_ID: "0".repeat(32) }));
	assert.throws(() => bootstrapEnvironment("staging", { WRANGLER_CI_OVERRIDE_NAME: "workflows-starter-template" }));
});
