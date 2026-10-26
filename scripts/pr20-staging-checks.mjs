import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertStagingTarget, validateArgs, TARGET } from "./pr20-staging.mjs";
import { FIXTURES, fixtureConfig } from "./pr20-fixtures.mjs";
import { assertNaturalTimeout } from "./pr20-acceptance.mjs";

test("accepts the independent v1 target", () => assertStagingTarget(fixtureConfig()));
for (const [name, mutate] of [
	["production worker", c => { c.name = "workflows-starter-template"; }],
	["existing v2 staging worker", c => { c.name = "workflows-starter-template-staging"; }],
	["production workflow", c => { c.workflows[0].name = "shion-av-content-pipeline"; }],
	["shared DO namespace", c => { c.durable_objects.bindings[0].script_name = "workflows-starter-template"; }],
	["workers.dev", c => { c.workers_dev = true; }],
	["preview URLs", c => { c.preview_urls = true; }],
	["public route", c => { c.routes = ["example.com/*"]; }],
	["singular route", c => { c.route = "example.com/*"; }],
	["migration removal", c => { c.migrations = []; }],
	["migration replacement", c => { c.migrations = [{ tag: "v2", deleted_classes: ["WorkflowStatusDO"] }]; }],
	["wrong account", c => { c.account_id = "0".repeat(32); }],
	["external service", c => { c.services = [{ binding: "PRODUCTION", service: "workflows-starter-template" }]; }],
]) test("blocks " + name, () => { const config = fixtureConfig(); mutate(config); assert.throws(() => assertStagingTarget(config)); });

test("deployment needs an exact head and refuses overrides", () => {
	assert.equal(validateArgs(["--dry-run"]), false);
	assert.equal(validateArgs(["--deploy", "a".repeat(40)]), true);
	for (const args of [[], ["--deploy"], ["--deploy", "main"], ["--dry-run", "--name", "production"]])
		assert.throws(() => validateArgs(args));
});
test("fixture refs are immutable and contain only reviewed worker sources", () => {
	for (const value of Object.values(FIXTURES)) {
		assert.match(value.ref, /^[a-f0-9]{40}$/);
		assert.ok(value.files.every(path => /^worker\/[a-z-]+\.ts$/.test(path)));
	}
});
test("private proxy connects only to staging and listens on loopback", () => {
	const config = JSON.parse(readFileSync(new URL("./pr20-proxy/wrangler.json", import.meta.url)));
	assert.deepEqual(config.services, [{ binding: "TARGET", service: TARGET, remote: true }]);
	assert.deepEqual(config.dev, { ip: "127.0.0.1", port: 8799 });
	assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
	assert.deepEqual(config.routes, []);
});

const now = 2 * 60 * 60 * 1000;
const start = () => ({ target: TARGET, kind: "natural-timeout", eventsSent: 0, waitingObservedAt: now - 60 * 60 * 1000 });
const result = () => {
	const snapshot = { type: "workflow_update", workflowStatus: "error", currentStep: null, errorMessage: "APPROVAL_TIMEOUT",
		stepStatuses: { "wait for editorial approval": "error", "publish to channels": "pending" }, timestamp: 1 };
	return { engine: { status: "errored" }, snapshot, reconnected: { ...snapshot, timestamp: 2 } };
};
test("accepts a natural timeout with matching reconnect", () => assertNaturalTimeout(start(), result(), now));
test("refuses an accelerated timeout", () => assert.throws(() => assertNaturalTimeout({ ...start(), waitingObservedAt: now - 3000 }, result(), now)));
test("refuses timeout receipts with an event", () => assert.throws(() => assertNaturalTimeout({ ...start(), eventsSent: 1 }, result(), now)));
test("refuses an engine that is still waiting", () => { const r = result(); r.engine.status = "waiting"; assert.throws(() => assertNaturalTimeout(start(), r, now)); });
test("refuses a publish checkpoint in the snapshot", () => { const r = result(); r.snapshot.stepStatuses["publish to channels"] = "completed"; assert.throws(() => assertNaturalTimeout(start(), r, now)); });
test("refuses a stale reconnect", () => { const r = result(); r.reconnected.workflowStatus = "running"; assert.throws(() => assertNaturalTimeout(start(), r, now)); });
