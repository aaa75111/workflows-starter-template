import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

/**
 * Shion AV Content Pipeline
 *
 * Models the lifecycle of a single piece of audio/video content, from raw
 * upload through to publication. Showcases:
 * - Durable step execution with step.do
 * - Time-based delays with step.sleep
 * - Interactive pausing with step.waitForEvent
 * - Data flow between steps
 *
 * @see https://developers.cloudflare.com/workflows
 */
export class ShionPipelineWorkflow extends WorkflowEntrypoint<
	Env,
	Record<string, unknown>
> {
	async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
		const instanceId = event.instanceId;

		// Notify Durable Object of step progress. Called outside step.do, so this
		// operation may repeat. Safe here because updateStep is idempotent.
		// Refer to: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
		const notifyStep = async (
			stepName: string,
			status: "running" | "completed" | "waiting",
		) => {
			try {
				const doId = this.env.WORKFLOW_STATUS.idFromName(instanceId);
				const stub = this.env.WORKFLOW_STATUS.get(doId);
				await stub.updateStep(stepName, status);
			} catch {
				// Silently fail
			}
		};

		// Step 1: Ingest the uploaded audio/video file - shows step.do usage
		await notifyStep("ingest media", "running");
		const media = await step.do("ingest media", async () => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return { ingested: true, durationSec: 342, timestamp: Date.now() };
		});
		await notifyStep("ingest media", "completed");

		// Step 2: Transcode to delivery formats & normalize audio - shows step.sleep for delays
		await notifyStep("transcode & normalize", "running");
		await step.sleep("transcode & normalize", "2 seconds");
		await notifyStep("transcode & normalize", "completed");

		// Step 3: Wait for editorial approval - shows interactive step.waitForEvent
		await notifyStep("wait for editorial approval", "waiting");
		const approval = await step.waitForEvent("wait for editorial approval", {
			type: "editorial-approval",
			timeout: "60 minutes",
		});
		await notifyStep("wait for editorial approval", "completed");

		// Step 4: Publish to channels - final step
		await notifyStep("publish to channels", "running");
		await step.do("publish to channels", async () => {
			console.log("Results:", { media, approval: approval.payload });
			await new Promise((resolve) => setTimeout(resolve, 1000));
		});
		await notifyStep("publish to channels", "completed");
	}
}
