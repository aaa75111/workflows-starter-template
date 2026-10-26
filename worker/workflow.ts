import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { approvalFailure, isWorkflowTimeout } from "./approval";

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
		const ingest = "ingest media";
		const transcode = "transcode & normalize";
		const review = "wait for editorial approval";
		const publish = "publish to channels";
		const stub = this.env.WORKFLOW_STATUS.get(
			this.env.WORKFLOW_STATUS.idFromName(instanceId),
		);

		let activeStep = ingest;
		let failureCode = "STEP_FAILED";

		// Journal status writes so transient failures retry and a failed
		// pre-publish notification cannot silently allow publication.
		// Refer to: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
		const notifyStep = async (
			stepName: string,
			status: "running" | "completed" | "waiting",
		) => {
			await step.do(`notify ${stepName}: ${status}`, async () => {
				await stub.updateStep(stepName, status);
			});
		};

		try {
			// The marker is written by this Workflow version, never by HTTP.
			await step.do("register approval gate", async () => {
				await stub.registerApprovalGate();
			});
			// Step 1: Ingest the uploaded audio/video file - shows step.do usage
			await notifyStep(ingest, "running");
			const media = await step.do(ingest, async () => {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				return { ingested: true, durationSec: 342, timestamp: Date.now() };
			});
			await notifyStep(ingest, "completed");

			// Step 2: Transcode to delivery formats & normalize audio - shows step.sleep for delays
			activeStep = transcode;
			await notifyStep(transcode, "running");
			await step.sleep(transcode, "2 seconds");
			await notifyStep(transcode, "completed");

			// Step 3: Wait for editorial approval - shows interactive step.waitForEvent
			activeStep = review;
			await notifyStep(review, "waiting");
			failureCode = "APPROVAL_WAIT_FAILED";
			const approval = await step.waitForEvent(review, {
				type: "editorial-approval",
				timeout: "60 minutes",
			});
			const decisionFailure = await step.do("validate approval", async () => approvalFailure(approval.payload));
			failureCode = decisionFailure ?? "STEP_FAILED";
			if (decisionFailure) {
				throw new Error(decisionFailure);
			}
			await notifyStep(review, "completed");

			// Step 4: Publish to channels only after a boolean approved: true
			activeStep = publish;
			await notifyStep(publish, "running");
			await step.do(publish, async () => {
				console.log("Results:", { media, approval: approval.payload });
				await new Promise((resolve) => setTimeout(resolve, 1000));
			});
			await notifyStep(publish, "completed");
		} catch (error) {
			if (failureCode === "APPROVAL_WAIT_FAILED" && isWorkflowTimeout(error)) {
				failureCode = "APPROVAL_TIMEOUT";
			}
			try {
				await step.do("record workflow failure", async () => {
					await stub.markError(failureCode, activeStep);
				});
			} catch {
				// Preserve the original engine error after status retries are exhausted.
				console.error("Workflow status persistence failed", { instanceId, failureCode });
			}
			throw error;
		}
	}
}
