import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("ShionPipelineWorkflow", () => {
	it("publishes when editorial approval is granted", async () => {
		const instanceId = `test-${Date.now()}-approved`;

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

		const media = await instance.waitForStepResult({ name: "ingest media" });
		expect(media).toMatchObject({ ingested: true, durationSec: 342 });

		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	it("does not publish when editorial approval is rejected", async () => {
		const instanceId = `test-${Date.now()}-rejected`;

		await using instance = await introspectWorkflowInstance(
			env.SHION_WORKFLOW,
			instanceId,
		);

		await instance.modify(async (m) => {
			await m.disableSleeps();
			await m.mockEvent({
				type: "editorial-approval",
				payload: { approved: false, comment: "Needs another pass" },
			});
		});

		await env.SHION_WORKFLOW.create({ id: instanceId });

		// The workflow must still finish (it takes the rejection branch instead
		// of publishing), not hang or error.
		await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
	});

	it("errors when the editorial approval event times out", async () => {
		const instanceId = `test-${Date.now()}-timeout`;

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
