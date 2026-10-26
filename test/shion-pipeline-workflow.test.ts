import { env, SELF, introspectWorkflowInstance, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, it, expect } from "vitest";
import { prepareAvStatus } from "../worker/av-compatibility";

const review = "wait for editorial approval";
const publish = "publish to channels";
const stubFor = (id: string) => env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(id));

async function socketSnapshot(id: string, path = "/ws/av") {
	const response = await SELF.fetch(`https://test${path}?instanceId=${id}`, {
		headers: { Upgrade: "websocket" },
	});
	expect(response.status).toBe(101);
	const ws = response.webSocket!;
	const message = new Promise<MessageEvent>((resolve) => ws.addEventListener("message", resolve, { once: true }));
	ws.accept();
	try {
		return JSON.parse((await message).data as string);
	} finally {
		const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
		ws.close(1000);
		await closed;
	}
}

async function sendDecision(id: string, payload: unknown, query = "") {
	return SELF.fetch(`https://test/api/av/workflow/event/${id}${query}`, {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
	});
}

describe("SHION approval gate in the Workers runtime", () => {
	it("publishes the simulation only after explicit true, and persists completion", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({ type: "editorial-approval", payload: { approved: true } });
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("complete");
		expect(await instance.waitForStepResult({ name: "ingest media" })).toMatchObject({ ingested: true });
		await expect(instance.waitForStepResult({ name: publish })).resolves.toBeUndefined();
		await evictDurableObject(stubFor(id));
		expect(await socketSnapshot(id)).toMatchObject({
			workflowStatus: "completed", currentStep: null, stepStatuses: { [publish]: "completed" }, errorMessage: null,
		});
	});

	it.each([
		["rejection", { approved: false }, "APPROVAL_REJECTED"],
		["missing field", {}, "INVALID_APPROVAL"],
		["string true", { approved: "true" }, "INVALID_APPROVAL"],
		["string false", { approved: "false" }, "INVALID_APPROVAL"],
		["number", { approved: 1 }, "INVALID_APPROVAL"],
		["null", null, "INVALID_APPROVAL"],
		["array", [{ approved: true }], "INVALID_APPROVAL"],
		["invalid comment", { approved: true, comment: 1 }, "INVALID_APPROVAL"],
	])("blocks %s before the publish step", async (_name, payload, code) => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, { ingested: true });
			await m.mockEvent({ type: "editorial-approval", payload });
			// A tripwire: entering publish would change the engine error to this.
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain(code);
		expect(await stubFor(id).getStateMessage()).toMatchObject({
			workflowStatus: code === "APPROVAL_REJECTED" ? "rejected" : "error", currentStep: null,
			stepStatuses: { [review]: code === "APPROVAL_REJECTED" ? "rejected" : "error", [publish]: code === "APPROVAL_REJECTED" ? "rejected" : "pending" }, errorMessage: code,
		});
		await evictDurableObject(stubFor(id));
		expect(await socketSnapshot(id)).toMatchObject({ workflowStatus: code === "APPROVAL_REJECTED" ? "rejected" : "error", errorMessage: code });
	});

	it("times out safely and exposes the terminal result over HTTP and WebSocket", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.forceEventTimeout({ name: review });
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("timed out");
		const response = await SELF.fetch(`https://test/api/av/workflow/status/${id}`);
		expect(await response.json()).toMatchObject({ status: "errored" });
		expect(await socketSnapshot(id)).toMatchObject({
			workflowStatus: "error", stepStatuses: { [publish]: "pending" }, errorMessage: "APPROVAL_TIMEOUT",
		});
		expect((await sendDecision(id, { approved: true })).status).toBe(409);
	});

	it("routes HTTP rejection, ignores queued/late approvals, and reconnects to the rejection", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		expect((await socketSnapshot(id)).stepStatuses[review]).toBe("waiting");
		expect((await sendDecision(id, { approved: false })).ok).toBe(true);
		await sendDecision(id, { approved: true });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("APPROVAL_REJECTED");
		expect((await sendDecision(id, { approved: true })).status).toBe(409);
		await evictDurableObject(stubFor(id));
		expect(await socketSnapshot(id)).toMatchObject({
			workflowStatus: "rejected", errorMessage: "APPROVAL_REJECTED", stepStatuses: { [publish]: "rejected" },
		});
	});

	it("does not accept the legacy event type as editorial approval", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		const workflow = await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		await workflow.sendEvent({ type: "user-approval", payload: { approved: true } });
		expect((await sendDecision(id, { approved: false })).ok).toBe(true);
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("APPROVAL_REJECTED");
		expect((await stubFor(id).getStateMessage()).stepStatuses[publish]).toBe("rejected");
	});

	it("broadcasts the rejection to a connected WebSocket", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		const response = await SELF.fetch(`https://test/ws/av?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		const ws = response.webSocket!;
		const updates: Record<string, unknown>[] = [];
		const stopped = new Promise<Record<string, unknown>>((resolve) => {
			ws.addEventListener("message", (event) => {
				const state = JSON.parse(event.data as string);
				updates.push(state);
				if (state.workflowStatus === "rejected") resolve(state);
			});
		});
		ws.accept();
		try {
			expect((await sendDecision(id, { approved: false })).ok).toBe(true);
			expect(await stopped).toMatchObject({ errorMessage: "APPROVAL_REJECTED", stepStatuses: { [publish]: "rejected" } });
			await instance.waitForStatus("errored");
			for (const state of updates) expect((state.stepStatuses as Record<string, string>)[publish]).not.toMatch(/running|completed/);
		} finally {
			const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
			ws.close(1000);
			await closed;
		}
	});

	it.each(["ingest media", publish])("persists a failure in %s", async (name) => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.disableRetryDelays();
			if (name !== "ingest media") await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name }, new Error("SIMULATED_STEP_FAILURE"));
			await m.mockEvent({ type: "editorial-approval", payload: { approved: true } });
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("SIMULATED_STEP_FAILURE");
		expect(await stubFor(id).getStateMessage()).toMatchObject({ workflowStatus: "error", errorMessage: "STEP_FAILED", stepStatuses: { [name]: "error" } });
	});

	it("fails closed when the pre-publish status notification cannot be saved", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockEvent({ type: "editorial-approval", payload: { approved: true } });
			await m.disableRetryDelays();
			await m.mockStepError({ name: `notify ${publish}: running` }, new Error("STATUS_UNAVAILABLE"));
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("STATUS_UNAVAILABLE");
		expect(await stubFor(id).getStateMessage()).toMatchObject({ workflowStatus: "error", errorMessage: "STEP_FAILED" });
	});
});

const AV_STEPS = ["ingest media", "transcode & normalize", review, publish];
const LEGACY_STEPS = ["process data", "wait 2 seconds", "wait for approval", "final"];
const oldStubFor = (id: string) => env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(id));

async function seedPr6Snapshot(id: string, status = "completed") {
	const snapshot = Object.fromEntries(AV_STEPS.map((name) => [name, status]));
	await runInDurableObject(oldStubFor(id), async (_object, state) => {
		await state.storage.put({ stepStatuses: snapshot, currentStep: null, workflowStatus: status === "completed" ? "completed" : "running" });
	});
	await evictDurableObject(oldStubFor(id));
	return snapshot;
}

describe("legacy and pre-isolation compatibility", () => {
	it("preserves old AV snapshots and reads their live original WebSocket without using a stale copy", async () => {
		const id = crypto.randomUUID();
		const original = await seedPr6Snapshot(id, "pending");
		await prepareAvStatus(env, id);
		expect(await stubFor(id).getStateMessage()).toMatchObject({ workflowStatus: "running", stepStatuses: original });
		expect((await oldStubFor(id).getStateMessage()).stepStatuses).toEqual(original);
		// The old engine can keep updating its original DO after the copy.
		await oldStubFor(id).updateStep("ingest media", "completed");
		expect(await socketSnapshot(id, "/ws")).toMatchObject({ type: "workflow_update", workflowStatus: "running", stepStatuses: { ...original, "ingest media": "completed" } });
		expect((await stubFor(id).getStateMessage()).stepStatuses).toEqual(original);
		const response = await SELF.fetch(`https://test/ws/av?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: "LEGACY_INSTANCE_REQUIRES_REVIEW" });
	});

	it.each([{ approved: true }, { approved: false }, { approved: "true" }])("blocks legacy AV decisions on both event routes without stopping or changing the instance: %j", async (decision) => {
		const id = crypto.randomUUID();
		const original = await seedPr6Snapshot(id, "pending");
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		for (const route of ["/api/workflow/event/", "/api/av/workflow/event/"]) {
			const response = await SELF.fetch(`https://test${route}${id}`, {
				method: "POST", body: JSON.stringify(decision),
			});
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ code: "LEGACY_INSTANCE_REQUIRES_REVIEW" });
		}
		const status = await (await env.SHION_WORKFLOW.get(id)).status();
		expect(["running", "waiting"]).toContain(status.status);
		expect((await stubFor(id).getStateMessage()).stepStatuses[publish]).toBe("pending");
		expect(await (await SELF.fetch(`https://test/api/workflow/status/${id}`)).json()).toMatchObject({ status: status.status });
		expect((await oldStubFor(id).getStateMessage()).stepStatuses).toEqual(original);
	});

	it("keeps identical IDs in the original and isolated namespaces independent", async () => {
		const id = crypto.randomUUID();
		await using legacy = await introspectWorkflowInstance(env.MY_WORKFLOW, id);
		await using av = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await legacy.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "process data" }, {});
			await m.mockStepResult({ name: "final" }, {});
			await m.mockEvent({ type: "user-approval", payload: { approved: true } });
		});
		await av.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockEvent({ type: "editorial-approval", payload: { approved: false } });
		});
		await env.MY_WORKFLOW.create({ id });
		await legacy.waitForStatus("complete");
		await env.SHION_WORKFLOW.create({ id });
		await av.waitForStatus("errored");
		expect(await socketSnapshot(id, "/ws")).toMatchObject({ type: "workflow_update", workflowStatus: "completed", stepStatuses: Object.fromEntries(LEGACY_STEPS.map((step) => [step, "completed"])) });
		expect(await socketSnapshot(id)).toMatchObject({ type: "av_workflow_update", workflowStatus: "rejected" });
		expect(await (await SELF.fetch(`https://test/api/workflow/status/${id}`)).json()).toMatchObject({ status: "complete" });
	});

	it("refuses mixed old snapshots without altering their data", async () => {
		const id = crypto.randomUUID();
		const snapshot = { "process data": "pending", "ingest media": "completed" };
		await runInDurableObject(oldStubFor(id), async (_object, state) => { await state.storage.put("stepStatuses", snapshot); });
		await evictDurableObject(oldStubFor(id));
		const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		expect(response.status).toBe(409);
		expect((await oldStubFor(id).getStateMessage()).stepStatuses).toEqual(snapshot);
	});

	it("does not overwrite isolated terminal state with an old snapshot or regress completed steps", async () => {
		const id = crypto.randomUUID();
		const stub = stubFor(id);
		await stub.updateStep("ingest media", "completed");
		await stub.updateStep("ingest media", "running");
		expect((await stub.getStateMessage()).stepStatuses["ingest media"]).toBe("completed");
		await stub.markError("APPROVAL_REJECTED", review);
		await seedPr6Snapshot(id);
		await evictDurableObject(stub);
		await prepareAvStatus(env, id);
		expect(await stub.getStateMessage()).toMatchObject({ workflowStatus: "rejected", errorMessage: "APPROVAL_REJECTED" });
		await runInDurableObject(stub, async (object) => {
			await expect(object.updateStep(publish, "running")).rejects.toThrow("already stopped");
		});
	});
});
