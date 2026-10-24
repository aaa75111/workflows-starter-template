import {
	env,
	SELF,
	introspectWorkflowInstance,
	evictDurableObject,
	runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	return new Promise((resolve) => {
		socket.addEventListener("message", resolve, { once: true });
	});
}

async function connectStatus(instanceId: string, path = "/ws") {
	const response = await SELF.fetch(
		`https://test${path}?instanceId=${instanceId}`,
		{ headers: { Upgrade: "websocket" } },
	);
	expect(response.status).toBe(101);
	const socket = response.webSocket!;
	const initial = nextMessage(socket);
	socket.accept();
	return { socket, initial };
}

async function closeSocket(socket: WebSocket) {
	const closed = new Promise<void>((resolve) => {
		socket.addEventListener("close", () => resolve(), { once: true });
	});
	socket.close(1000);
	await closed;
}

describe("Cloudflare dependency compatibility", () => {
	// This repo's demo is isolated from the SHION editorial-approval pipeline
	// (see worker/index.ts and AGENTS.md): the generic MY_WORKFLOW/WORKFLOW_STATUS
	// routes below stay untouched, and SHION_WORKFLOW/AV_WORKFLOW_STATUS get their
	// own /api/av/workflow/* and /ws/av routes. Exercise those isolated routes here
	// rather than the pre-isolation /api/workflow/* + /ws surface.
	it("routes HTTP editorial approval to SHION_WORKFLOW and completes all four stages", async () => {
		const id = crypto.randomUUID();
		await using instance = await introspectWorkflowInstance(env.SHION_WORKFLOW, id);
		await instance.modify(async (m) => {
			await m.disableSleeps();
		});
		await env.SHION_WORKFLOW.create({ id });
		await instance.waitForStepResult({ name: "ingest media" });

		const approval = await SELF.fetch(`https://test/api/av/workflow/event/${id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ approved: true }),
		});
		expect(approval.status).toBe(200);
		expect(await approval.json()).toMatchObject({ success: true });
		await instance.waitForStatus("complete");
		await expect(
			instance.waitForStepResult({ name: "publish to channels" }),
		).resolves.toBeUndefined();

		const status = await SELF.fetch(`https://test/api/av/workflow/status/${id}`);
		expect(status.status).toBe(200);
		expect(await status.json()).toMatchObject({ status: "complete" });

		const { socket, initial } = await connectStatus(id, "/ws/av");
		try {
			expect(JSON.parse((await initial).data as string)).toMatchObject({
				type: "av_workflow_update",
				currentStep: null,
				workflowStatus: "completed",
				stepStatuses: {
					"ingest media": "completed",
					"transcode & normalize": "completed",
					"wait for editorial approval": "completed",
					"publish to channels": "completed",
				},
			});
		} finally {
			await closeSocket(socket);
		}
	});

	it("broadcasts Durable Object updates and restores the persisted state after eviction", async () => {
		const id = crypto.randomUUID();
		const stub = env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(id));
		const expected = {
			type: "av_workflow_update",
			currentStep: "wait for editorial approval",
			workflowStatus: "running",
			stepStatuses: { "wait for editorial approval": "waiting" },
		};
		const { socket, initial } = await connectStatus(id, "/ws/av");
		try {
			expect(JSON.parse((await initial).data as string)).toMatchObject({
				currentStep: null,
				stepStatuses: { "wait for editorial approval": "pending" },
			});
			const update = nextMessage(socket);
			await stub.updateStep("wait for editorial approval", "waiting");
			expect(JSON.parse((await update).data as string)).toMatchObject(expected);
			await runInDurableObject(stub, async (_instance, state) => {
				expect(await state.storage.get("stepStatuses")).toMatchObject({
					"wait for editorial approval": "waiting",
				});
				expect(await state.storage.get("currentStep")).toBe(
					"wait for editorial approval",
				);
			});
		} finally {
			await closeSocket(socket);
		}

		await evictDurableObject(stub);
		const reconnected = await connectStatus(id, "/ws/av");
		try {
			expect(JSON.parse((await reconnected.initial).data as string)).toMatchObject(expected);
		} finally {
			await closeSocket(reconnected.socket);
		}
	});
});
