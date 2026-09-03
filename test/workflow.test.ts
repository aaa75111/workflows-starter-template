import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, it, expect } from "vitest";

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
	});
});
