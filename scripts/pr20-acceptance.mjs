import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TARGET } from "./pr20-staging.mjs";

const ORIGIN = "http://127.0.0.1:8799";
const REVIEW = "wait for editorial approval", PUBLISH = "publish to channels";
const HOUR = 60 * 60 * 1000;

export function normalizeSnapshot(snapshot) {
	assert.equal(snapshot.type, "workflow_update");
	assert.equal(typeof snapshot.stepStatuses, "object");
	assert.ok(snapshot.stepStatuses && !Array.isArray(snapshot.stepStatuses));
	return { currentStep: snapshot.currentStep, workflowStatus: snapshot.workflowStatus,
		stepStatuses: snapshot.stepStatuses, errorMessage: snapshot.errorMessage ?? null };
}

export function assertNaturalTimeout(start, result, now = Date.now()) {
	assert.equal(start.target, TARGET);
	assert.equal(start.kind, "natural-timeout");
	assert.equal(start.eventsSent, 0);
	assert.ok(Number.isFinite(start.waitingObservedAt));
	assert.ok(now - start.waitingObservedAt >= HOUR, "Natural timeout requires at least 60 elapsed minutes");
	assert.equal(result.engine.status, "errored");
	assert.equal(result.snapshot.workflowStatus, "error");
	assert.equal(result.snapshot.currentStep, null);
	assert.equal(result.snapshot.errorMessage, "APPROVAL_TIMEOUT");
	assert.equal(result.snapshot.stepStatuses[REVIEW], "error");
	assert.equal(result.snapshot.stepStatuses[PUBLISH], "pending");
	assert.deepEqual(normalizeSnapshot(result.reconnected), normalizeSnapshot(result.snapshot));
}

async function json(path, init) {
	const response = await fetch(ORIGIN + path, { ...init, signal: AbortSignal.timeout(15000) });
	const body = await response.json();
	return { status: response.status, body };
}

async function connect(id) {
	const ws = new WebSocket(ORIGIN.replace("http:", "ws:") + "/ws?instanceId=" + encodeURIComponent(id));
	try {
		return await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("WebSocket snapshot timed out")), 15000);
			ws.addEventListener("message", event => {
				clearTimeout(timer);
				try { resolve(JSON.parse(String(event.data))); } catch { reject(new Error("Invalid WebSocket JSON")); }
			}, { once: true });
			ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); }, { once: true });
		});
	} finally { ws.close(); }
}

async function capture(id) {
	assert.match(id, /^[a-zA-Z0-9_-]+$/);
	const engine = await json("/api/workflow/status/" + encodeURIComponent(id));
	assert.equal(engine.status, 200);
	return { capturedAt: new Date().toISOString(), engine: engine.body, snapshot: await connect(id) };
}

async function main(args) {
	assert.ok(args.length >= 2 && args.length <= 3, "Use start-legacy OUT | start-timeout OUT | check-legacy START OUT | collect-timeout START OUT");
	const [command, file, output] = args;
	assert.ok(["start-legacy", "start-timeout", "check-legacy", "collect-timeout"].includes(command));
	assert.equal(args.length, command.startsWith("start-") ? 2 : 3);
	const identity = await json("/__target");
	assert.equal(identity.status, 200);
	assert.equal(identity.body.target, TARGET, "Wrong private proxy target");
	if (command.startsWith("start-")) {
		// Refuse overwrite before creating any engine.
		const receipt = { target: TARGET, kind: command === "start-legacy" ? "legacy" : "natural-timeout",
			createdAt: new Date().toISOString(), eventsSent: 0, journalVerified: false, storageBackupVerified: false };
		writeFileSync(file, JSON.stringify(receipt, null, 2), { flag: "wx" });
		const started = await json("/api/workflow/start", { method: "POST" });
		assert.equal(started.status, 200);
		assert.equal(typeof started.body.instanceId, "string");
		receipt.instanceId = started.body.instanceId;
		writeFileSync(file, JSON.stringify(receipt, null, 2));
		for (let attempt = 0; attempt < 30; attempt++) {
			const current = await capture(receipt.instanceId);
			if (current.snapshot.stepStatuses[REVIEW] === "waiting") {
				receipt.waitingObservedAt = Date.now();
				receipt.baseline = current;
				writeFileSync(file, JSON.stringify(receipt, null, 2));
				console.log(JSON.stringify({ instanceId: receipt.instanceId, receipt: file, collectNotBefore: new Date(receipt.waitingObservedAt + HOUR).toISOString() }));
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		throw new Error("No waiting snapshot observed; preserve receipt and inspect the engine");
	}
	const start = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(start.target, TARGET);
	assert.equal(start.eventsSent, 0);
	assert.ok(start.baseline && Number.isFinite(start.waitingObservedAt), "Incomplete start receipt");
	if (command === "collect-timeout") {
		assert.equal(start.kind, "natural-timeout");
		assert.ok(Date.now() - start.waitingObservedAt >= HOUR, "Wait 60 real minutes before collection");
		const result = { target: TARGET, instanceId: start.instanceId, ...await capture(start.instanceId) };
		result.reconnected = await connect(start.instanceId);
		result.journalVerified = false;
		result.storageBackupVerified = false;
		writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
		assertNaturalTimeout(start, result);
		console.log("Engine, application snapshot and reconnect passed; attach the independent engine journal and durable-storage evidence before sign-off.");
		return;
	}
	assert.equal(start.kind, "legacy");
	assert.ok(Date.now() - start.waitingObservedAt < 50 * 60 * 1000, "Legacy fixture is too close to its own timeout; create another disposable fixture");
	const before = await capture(start.instanceId);
	assert.deepEqual(normalizeSnapshot(before.snapshot), normalizeSnapshot(start.baseline.snapshot));
	assert.equal(before.snapshot.stepStatuses[REVIEW], "waiting");
	const result = { target: TARGET, instanceId: start.instanceId, before, decisions: [],
		journalVerified: false, storageBackupVerified: false };
	writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
	for (const approved of [false, true, "true"]) {
		const decision = await json("/api/workflow/event/" + encodeURIComponent(start.instanceId), {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }),
		});
		result.decisions.push({ approved, ...decision });
		writeFileSync(output, JSON.stringify(result, null, 2));
		assert.equal(decision.status, typeof approved === "boolean" ? 409 : 400, "STOP: unexpected event forwarding; inspect the disposable fixture journal");
		if (typeof approved === "boolean") assert.equal(decision.body.code, "LEGACY_INSTANCE_REQUIRES_REVIEW");
	}
	result.after = await capture(start.instanceId);
	result.reconnected = await connect(start.instanceId);
	writeFileSync(output, JSON.stringify(result, null, 2));
	assert.ok(["running", "waiting"].includes(result.after.engine.status));
	assert.deepEqual(normalizeSnapshot(result.after.snapshot), normalizeSnapshot(start.baseline.snapshot));
	assert.deepEqual(normalizeSnapshot(result.reconnected), normalizeSnapshot(start.baseline.snapshot));
	console.log("HTTP quarantine and original WebSocket snapshot passed; raw storage hashes and engine journal still require independent verification.");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
	main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
