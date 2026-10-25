import {
	env,
	introspectWorkflowInstance,
	runInDurableObject,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { approvalFailure } from "../worker/approval";

async function storedStatus(instanceId: string) {
	const stub = env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(instanceId));
	return runInDurableObject(stub, async (_instance, state) => ({
		workflowStatus: await state.storage.get("workflowStatus"),
		errorMessage: await state.storage.get("errorMessage"),
		stepStatuses: await state.storage.get("stepStatuses"),
	}));
}

describe("approvalFailure", () => {
	it("accepts only a boolean approved field", () => {
		expect(approvalFailure({ approved: true })).toBeNull();
		expect(approvalFailure({ approved: false, comment: "no" })).toBe(
			"APPROVAL_REJECTED",
		);
		expect(approvalFailure({ approved: "true" })).toBe("INVALID_APPROVAL");
		expect(approvalFailure({ approved: true, comment: 1 })).toBe(
			"INVALID_APPROVAL",
		);
		expect(approvalFailure(null)).toBe("INVALID_APPROVAL");
	});
});

describe("ShionPipelineWorkflow", () => {
	it("completes and returns expected step result", async () => {
		const instanceId = `test-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({
				type: "editorial-approval",
				payload: { approved: true },
			});
		});

		await env.SHION_WORKFLOW.create({ id: instanceId });

		const result = await instance.waitForStepResult({ name: "ingest media" });

		expect(result).toMatchObject({
			ingested: true,
		});
		expect(result).toHaveProperty("timestamp");
	});

	it("errors when approval event times out", async () => {
		const instanceId = `test-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.forceEventTimeout({ name: "wait for editorial approval" });
		});

		await env.SHION_WORKFLOW.create({ id: instanceId });

		await expect(instance.waitForStatus("errored")).resolves.not.toThrow();
		await expect(storedStatus(instanceId)).resolves.toMatchObject({
			workflowStatus: "error",
			errorMessage: "APPROVAL_TIMEOUT",
			stepStatuses: {
				"wait for editorial approval": "error",
				"publish to channels": "pending",
			},
		});
	});

	it("rejects a false approval without publishing", async () => {
		const instanceId = `test-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({
				type: "editorial-approval",
				payload: { approved: false },
			});
		});

		await env.SHION_WORKFLOW.create({ id: instanceId });

		await expect(instance.waitForStatus("errored")).resolves.not.toThrow();
		await expect(storedStatus(instanceId)).resolves.toMatchObject({
			workflowStatus: "rejected",
			errorMessage: "APPROVAL_REJECTED",
			stepStatuses: {
				"wait for editorial approval": "rejected",
				"publish to channels": "rejected",
			},
		});
	});

	it("rejects a string true payload without publishing", async () => {
		const instanceId = `test-${Date.now()}`;

		await using instance = await introspectWorkflowInstance(
			env.SHION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({
				type: "editorial-approval",
				payload: { approved: "true" },
			});
		});

		await env.SHION_WORKFLOW.create({ id: instanceId });

		await expect(instance.waitForStatus("errored")).resolves.not.toThrow();
		await expect(storedStatus(instanceId)).resolves.toMatchObject({
			workflowStatus: "error",
			errorMessage: "INVALID_APPROVAL",
			stepStatuses: {
				"wait for editorial approval": "error",
				"publish to channels": "pending",
			},
		});
	});
});
