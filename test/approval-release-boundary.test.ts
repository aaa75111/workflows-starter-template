import { env, SELF, introspectWorkflowInstance, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, it, expect } from "vitest";

const review = "wait for editorial approval";
const publish = "publish to channels";
const stubFor = (id: string) => env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(id));

async function snapshot(id: string) {
	const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
	expect(response.status).toBe(101);
	const ws = response.webSocket!;
	const received = new Promise<MessageEvent>((resolve) => ws.addEventListener("message", resolve, { once: true }));
	ws.accept();
	try {
		return JSON.parse((await received).data as string);
	} finally {
		const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
		ws.close(1000);
		await closed;
	}
}

const send = (id: string, body: unknown) => SELF.fetch(`https://test/api/workflow/event/${id}`, {
	method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("approval hotfix release boundaries", () => {
	it.each([
		["false", { approved: false }, "APPROVAL_REJECTED"],
		["missing", {}, "INVALID_APPROVAL"],
		["string true", { approved: "true" }, "INVALID_APPROVAL"],
		["string false", { approved: "false" }, "INVALID_APPROVAL"],
		["number", { approved: 1 }, "INVALID_APPROVAL"],
		["null", null, "INVALID_APPROVAL"],
		["array", [{ approved: true }], "INVALID_APPROVAL"],
		["invalid comment", { approved: true, comment: 1 }, "INVALID_APPROVAL"],
	])("never enters publish for %s and reconnects to the terminal result", async (_name, payload, code) => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockEvent({ type: "editorial-approval", payload });
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain(code);
		await evictDurableObject(stubFor(id));
		expect(await snapshot(id)).toMatchObject({
			currentStep: null,
			workflowStatus: code === "APPROVAL_REJECTED" ? "rejected" : "error",
			errorMessage: code,
			stepStatuses: { [publish]: code === "APPROVAL_REJECTED" ? "rejected" : "pending" },
		});
		expect((await send(id, { approved: true })).status).toBe(409);
	});

	it("broadcasts a timeout and restores it after eviction without publishing", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.forceEventTimeout({ name: review });
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		const ws = response.webSocket!;
		const stopped = new Promise<Record<string, unknown>>((resolve) => ws.addEventListener("message", (event) => {
			const value = JSON.parse(event.data as string);
			if (value.workflowStatus === "error") resolve(value);
		}));
		ws.accept();
		try {
			await env.SHION_WORKFLOW.create({ id });
			await instance.waitForStatus("errored");
			expect((await instance.getError()).message).toContain("timed out");
			expect(await stopped).toMatchObject({ errorMessage: "APPROVAL_TIMEOUT", currentStep: null, stepStatuses: { [publish]: "pending" } });
		} finally {
			const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
			ws.close(1000);
			await closed;
		}
		await evictDurableObject(stubFor(id));
		expect(await snapshot(id)).toMatchObject({ workflowStatus: "error", errorMessage: "APPROVAL_TIMEOUT" });
	});

	it("broadcasts rejection and rejects a later approval", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		const response = await SELF.fetch(`https://test/ws?instanceId=${id}`, { headers: { Upgrade: "websocket" } });
		const ws = response.webSocket!;
		const stopped = new Promise<Record<string, unknown>>((resolve) => ws.addEventListener("message", (event) => {
			const value = JSON.parse(event.data as string);
			if (value.workflowStatus === "rejected") resolve(value);
		}));
		ws.accept();
		try {
			expect((await send(id, { approved: false })).status).toBe(200);
			expect(await stopped).toMatchObject({ errorMessage: "APPROVAL_REJECTED", stepStatuses: { [publish]: "rejected" } });
			await instance.waitForStatus("errored");
			expect((await instance.getError()).message).toContain("APPROVAL_REJECTED");
			expect((await send(id, { approved: true })).status).toBe(409);
		} finally {
			const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));
			ws.close(1000);
			await closed;
		}
	});

	it("blocks all unmarked decisions while preserving the waiting engine and stored snapshot", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: `notify ${review}: waiting` });
		const stub = stubFor(id);
		// A legacy fixture has no proof that its execution runs the new gate.
		await runInDurableObject(stub, async (_object, state) => {
			await state.storage.delete("approvalGateVersion");
		});
		const before = await runInDurableObject(stub, async (_object, state) => Object.fromEntries(await state.storage.list()));
		for (const approved of [true, false]) {
			const response = await send(id, { approved });
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ code: "LEGACY_INSTANCE_REQUIRES_REVIEW" });
		}
		expect((await send(id, { approved: "true" })).status).toBe(400);
		const after = await runInDurableObject(stub, async (_object, state) => Object.fromEntries(await state.storage.list()));
		expect(after).toEqual(before);
		expect(["running", "waiting"]).toContain((await (await env.SHION_WORKFLOW.get(id)).status()).status);
		await evictDurableObject(stub);
		expect(await snapshot(id)).toMatchObject({ currentStep: review, workflowStatus: "running", stepStatuses: { [publish]: "pending" } });
		expect(await stub.hasApprovalGate()).toBe(false);
	});

	it("keeps pre-existing generic step names and storage readable", async () => {
		const id = crypto.randomUUID();
		const stub = stubFor(id);
		const old = { stepStatuses: { "process data": "completed", "wait 2 seconds": "completed", "wait for approval": "waiting", final: "pending" }, currentStep: "wait for approval", workflowStatus: "running" };
		await runInDurableObject(stub, async (_object, state) => { await state.storage.put(old); });
		await evictDurableObject(stub);
		expect(await snapshot(id)).toMatchObject(old);
		expect((await send(id, { approved: true })).status).toBe(409);
		expect(await runInDurableObject(stub, async (_object, state) => Object.fromEntries(await state.storage.list()))).toEqual(old);
	});

	it.each(["register approval gate", `notify ${publish}: running`, publish])("fails safely and preserves STEP_FAILED at %s", async (name) => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.disableRetryDelays();
			await m.mockStepResult({ name: "ingest media" }, {});
			await m.mockEvent({ type: "editorial-approval", payload: { approved: true } });
			if (name !== publish) await m.mockStepError({ name: publish }, new NonRetryableError("UNEXPECTED_PUBLISH"));
			await m.mockStepError({ name }, new NonRetryableError("SIMULATED_FAILURE"));
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStatus("errored");
		expect((await instance.getError()).message).toContain("SIMULATED_FAILURE");
		expect(await snapshot(id)).toMatchObject({ workflowStatus: "error", errorMessage: "STEP_FAILED" });
	});

	it("returns 400 for malformed JSON and never creates gate metadata from HTTP", async () => {
		const id = crypto.randomUUID();
		const response = await SELF.fetch(`https://test/api/workflow/event/${id}`, { method: "POST", body: "{" });
		expect(response.status).toBe(400);
		expect((await send(id, { approved: true })).status).toBe(409);
		expect(await stubFor(id).hasApprovalGate()).toBe(false);
	});
});
