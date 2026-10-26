import { env, SELF, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { isLegacyAvSnapshot, prepareAvStatus } from "../worker/av-compatibility";

const steps = ["ingest media", "transcode & normalize", "wait for editorial approval", "publish to channels"];
const review = steps[2], publish = steps[3];
const original = (id: string) => env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(id));
const isolated = (id: string) => env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(id));

function fixture(kind: string) {
	const stepStatuses = Object.fromEntries(steps.map((step) => [step, "completed"]));
	let workflowStatus = "completed";
	let currentStep: string | null = null;
	let errorMessage: string | null = null;
	if (kind === "waiting") {
		workflowStatus = "running"; currentStep = review;
		stepStatuses[review] = "waiting"; stepStatuses[publish] = "pending";
	} else if (kind === "rejected") {
		workflowStatus = "rejected"; errorMessage = "APPROVAL_REJECTED";
		stepStatuses[review] = "rejected"; stepStatuses[publish] = "rejected";
	} else if (kind === "timeout" || kind === "invalid") {
		workflowStatus = "error"; errorMessage = kind === "timeout" ? "APPROVAL_TIMEOUT" : "INVALID_APPROVAL";
		stepStatuses[review] = "error"; stepStatuses[publish] = "pending";
	}
	return { stepStatuses, workflowStatus, currentStep, errorMessage };
}

async function seed(id: string, value: Record<string, unknown>) {
	await runInDurableObject(original(id), async (_object, state) => { await state.storage.put(value); });
	await evictDurableObject(original(id));
}
const stored = (id: string) => runInDurableObject(original(id), async (_object, state) => Object.fromEntries(await state.storage.list()));

async function wsSnapshot(id: string) {
	const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
	expect(response.status).toBe(101);
	const ws = response.webSocket!;
	const first = new Promise<MessageEvent>((resolve) => ws.addEventListener("message", resolve, { once: true }));
	ws.accept();
	try { return JSON.parse((await first).data as string); }
	finally {
		const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
		ws.close(1000); await closed;
	}
}

describe("PR18 and PR20 snapshots remain readable and quarantined", () => {
	for (const marked of [false, true]) {
		it.each(["waiting", "completed", "rejected", "timeout", "invalid"])(`preserves %s snapshots (PR20 marker: ${marked})`, async (kind) => {
			const id = crypto.randomUUID();
			const expected = fixture(kind);
			const record = { ...expected, ...(marked ? { approvalGateVersion: "strict-editorial-v1" } : {}) };
			await seed(id, record);
			expect(await wsSnapshot(id)).toMatchObject({ type: "workflow_update", ...expected });
			for (const route of ["/api/workflow/event/", "/api/av/workflow/event/"]) {
				for (const approved of [true, false, "true"]) {
					const response = await SELF.fetch(`https://test${route}${id}`, { method: "POST", body: JSON.stringify({ approved }) });
					expect(response.status).toBe(409);
					expect(await response.json()).toMatchObject({ code: "LEGACY_INSTANCE_REQUIRES_REVIEW" });
				}
			}
			const response = await SELF.fetch(`https://test/ws/av?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
			expect(response.status).toBe(409);
			expect(await stored(id)).toEqual(record);

			await prepareAvStatus(env, id);
			await evictDurableObject(isolated(id));
			expect(await isolated(id).getStateMessage()).toMatchObject(expected);
			await evictDurableObject(original(id));
			expect(await wsSnapshot(id)).toMatchObject(expected);
			expect(await stored(id)).toEqual(record);
			// Import never copies the execution marker into another namespace.
			expect(await runInDurableObject(isolated(id), async (_object, state) => state.storage.get("approvalGateVersion"))).toBeUndefined();
		});
	}

	it("retains in-flight PR20 RPCs and publishes a live timeout on the original WebSocket", async () => {
		const id = crypto.randomUUID();
		await seed(id, fixture("waiting"));
		await original(id).registerApprovalGate();
		expect(await original(id).hasApprovalGate()).toBe(true);
		await prepareAvStatus(env, id);
		const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		const ws = response.webSocket!;
		const stopped = new Promise<Record<string, unknown>>((resolve) => ws.addEventListener("message", (event) => {
			const value = JSON.parse(event.data as string);
			if (value.workflowStatus === "error") resolve(value);
		}));
		ws.accept();
		try {
			await original(id).markError("APPROVAL_TIMEOUT", review);
			expect(await stopped).toMatchObject(fixture("timeout"));
		} finally {
			const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
			ws.close(1000); await closed;
		}
		await evictDurableObject(original(id));
		expect(await wsSnapshot(id)).toMatchObject(fixture("timeout"));
		expect(await original(id).hasApprovalGate()).toBe(true);
		// The imported copy is stale; it is never offered as the legacy live feed.
		expect(await isolated(id).getStateMessage()).toMatchObject(fixture("waiting"));
		expect((await SELF.fetch(`https://test/ws/av?instanceId=${id}`, { headers: { Upgrade: "websocket" } })).status).toBe(409);
	});

	it.each(["rejected", "timeout", "completed"])("does not rewrite %s when old notifications replay", async (kind) => {
		const id = crypto.randomUUID(), expected = fixture(kind);
		await seed(id, expected);
		await original(id).updateStep("ingest media", "running");
		await original(id).updateStep(publish, "completed");
		await original(id).markError("DIFFERENT_ERROR", review);
		expect(await stored(id)).toEqual(expected);
		await evictDurableObject(original(id));
		expect(await wsSnapshot(id)).toMatchObject(expected);
	});

	it("preserves newer isolated failure details when legacy imports repeat", async () => {
		const id = crypto.randomUUID();
		await seed(id, fixture("rejected"));
		await isolated(id).markError("NEWER_FAILURE", review);
		await prepareAvStatus(env, id);
		await evictDurableObject(isolated(id));
		expect(await isolated(id).getStateMessage()).toMatchObject({ workflowStatus: "error", errorMessage: "NEWER_FAILURE" });
		expect(await stored(id)).toEqual(fixture("rejected"));
	});

	it("preserves generic snapshots without adding AV fields", async () => {
		const id = crypto.randomUUID();
		const genericSteps = ["process data", "wait 2 seconds", "wait for approval", "final"];
		const snapshot = { stepStatuses: Object.fromEntries(genericSteps.map((name) => [name, "pending"])), currentStep: null, workflowStatus: "running" };
		await seed(id, snapshot);
		expect(await wsSnapshot(id)).toMatchObject(snapshot);
		expect(await wsSnapshot(id)).not.toHaveProperty("errorMessage");
		for (const name of genericSteps) await original(id).updateStep(name, "completed");
		await evictDurableObject(original(id));
		expect(await wsSnapshot(id)).toMatchObject({ workflowStatus: "completed", stepStatuses: Object.fromEntries(genericSteps.map((name) => [name, "completed"])) });
		expect(await wsSnapshot(id)).not.toHaveProperty("errorMessage");
	});

	it("accepts old AV snapshots that omit errorMessage without modifying them", async () => {
		const id = crypto.randomUUID();
		const waiting = fixture("waiting");
		const old = { stepStatuses: waiting.stepStatuses, currentStep: waiting.currentStep, workflowStatus: waiting.workflowStatus };
		await seed(id, old);
		expect(await wsSnapshot(id)).toMatchObject(old);
		expect(await wsSnapshot(id)).not.toHaveProperty("errorMessage");
		await prepareAvStatus(env, id);
		expect(await stored(id)).toEqual(old);
		expect(await isolated(id).getStateMessage()).toMatchObject({ ...old, errorMessage: null });
	});

	it.each([42, true, {}, [], undefined])("refuses an invalid errorMessage %j without weakening validation", (errorMessage) => {
		expect(() => isLegacyAvSnapshot({ ...fixture("rejected"), errorMessage })).toThrow("requires review");
	});

	it("still refuses mixed or unknown schemas", () => {
		expect(() => isLegacyAvSnapshot({ ...fixture("rejected"), stepStatuses: { ...fixture("rejected").stepStatuses, final: "pending" } })).toThrow("requires review");
		expect(() => isLegacyAvSnapshot({ ...fixture("rejected"), workflowStatus: "approved" })).toThrow("requires review");
	});
});
