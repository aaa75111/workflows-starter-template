import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

/**
 * Shion AV Content Pipeline (preview demo)
 *
 * Models ingest -> transcode & normalize -> editorial approval -> publish.
 * Deliberately isolated from the starter template's default MyWorkflow /
 * WorkflowStatusDO: separate Workflow binding (SHION_WORKFLOW), separate
 * Durable Object (AV_WORKFLOW_STATUS / AvWorkflowStatusDO) and separate API
 * routes (/api/av/workflow/*, /ws/av) in worker/index.ts. AGENTS.md requires
 * MY_WORKFLOW/WORKFLOW_STATUS and their routes to keep their current names
 * and behavior, so this demo adds to that surface instead of replacing it.
 *
 * Unlike the original starter demo, a rejected or timed-out approval must
 * not fall through to publishing, and the Durable Object must reflect
 * rejection/error so the WebSocket UI doesn't stay on "running"/"waiting".
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
			status: "running" | "completed" | "waiting" | "rejected",
		) => {
			try {
				const doId = this.env.AV_WORKFLOW_STATUS.idFromName(instanceId);
				const stub = this.env.AV_WORKFLOW_STATUS.get(doId);
				await stub.updateStep(stepName, status);
			} catch (err) {
				// Best-effort UI notification: the Workflow engine's own durable
				// step history is authoritative, so a failed status push only
				// means the WebSocket UI misses one update. Log it instead of
				// swallowing it silently, but don't fail the pipeline step over it.
				console.error("ShionPipelineWorkflow: notifyStep failed", {
					instanceId,
					stepName,
					status,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};

		const notifyError = async (message: string) => {
			try {
				const doId = this.env.AV_WORKFLOW_STATUS.idFromName(instanceId);
				const stub = this.env.AV_WORKFLOW_STATUS.get(doId);
				await stub.markError(message);
			} catch (err) {
				console.error("ShionPipelineWorkflow: notifyError failed", {
					instanceId,
					message,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};

		try {
			// Step 1: Ingest the uploaded audio/video file - shows step.do usage
			await notifyStep("ingest media", "running");
			const media = await step.do("ingest media", async () => {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				return { ingested: true, durationSec: 342, timestamp: Date.now() };
			});
			await notifyStep("ingest media", "completed");

			// Step 2: Transcode to delivery formats & normalize audio - shows step.sleep
			await notifyStep("transcode & normalize", "running");
			await step.sleep("transcode & normalize", "2 seconds");
			await notifyStep("transcode & normalize", "completed");

			// Step 3: Wait for editorial approval - shows interactive step.waitForEvent
			await notifyStep("wait for editorial approval", "waiting");
			const approval = await step.waitForEvent<{
				approved: boolean;
				comment?: string;
			}>("wait for editorial approval", {
				type: "editorial-approval",
				timeout: "60 minutes",
			});
			await notifyStep("wait for editorial approval", "completed");

			// Step 4: Publish to channels - only when editorial approval is
			// explicitly granted. A missing or false `approved` must never publish.
			if (approval.payload?.approved === true) {
				await notifyStep("publish to channels", "running");
				await step.do("publish to channels", async () => {
					console.log("Results:", { media, approval: approval.payload });
					await new Promise((resolve) => setTimeout(resolve, 1000));
				});
				await notifyStep("publish to channels", "completed");
			} else {
				await notifyStep("publish to channels", "rejected");
			}
		} catch (err) {
			// step.waitForEvent throws on timeout, and a step.do can throw after
			// exhausting retries. Either way the Workflow engine will mark this
			// instance errored; make sure the Durable Object (and therefore the
			// WebSocket UI) reflects that instead of staying on the last
			// "running"/"waiting" status, then rethrow so the engine still sees it.
			await notifyError(err instanceof Error ? err.message : String(err));
			throw err;
		}
	}
}
