import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { approvalFailure, prepareAvStatus } from "./av-compatibility";

// Preserve the four AV checkpoint names, including pre-isolation instances.
// All media operations remain simulations; the default demo is unchanged.
async function runPipeline(env: Env, event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
	const [ingest, transcode, review, publish] = ["ingest media", "transcode & normalize", "wait for editorial approval", "publish to channels"];
	const stub = env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(event.instanceId));
	let activeStep: string = ingest;
	let failureCode = "STEP_FAILED";

	// Journal notifications as well as operations, so replay cannot regress
	// completed steps. A failed notification must never silently allow publish.
	const notifyStep = (name: string, status: "running" | "completed" | "waiting") =>
		step.do(`notify ${name}: ${status}`, async () => {
			await stub.updateStep(name, status);
		});

	try {
		await step.do("import pre-isolation status", async () => { await prepareAvStatus(env, event.instanceId); });
		await notifyStep(ingest, "running");
		const media = await step.do(ingest, async () => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return { ingested: true, durationSec: 342, timestamp: Date.now() };
		});
		await notifyStep(ingest, "completed");

		activeStep = transcode;
		await notifyStep(transcode, "running");
		await step.sleep(transcode, "2 seconds");
		await notifyStep(transcode, "completed");

		activeStep = review;
		await notifyStep(review, "waiting");
		failureCode = "APPROVAL_WAIT_FAILED";
		const approval = await step.waitForEvent(review, {
			type: "editorial-approval",
			timeout: "60 minutes",
		});
		const decisionFailure = await step.do("validate approval", async () => approvalFailure(approval.payload));
		failureCode = decisionFailure ?? "STEP_FAILED";
		// Throw outside step.do: save the terminal outcome before the engine
		// stops. There is no retry of this top-level rejection.
		if (decisionFailure) throw new Error(decisionFailure);
		await notifyStep(review, "completed");

		activeStep = publish;
		await notifyStep(publish, "running");
		await step.do(publish, async () => {
			console.log("Simulated results:", { media, approval: approval.payload });
			await new Promise((resolve) => setTimeout(resolve, 1000));
		});
		await notifyStep(publish, "completed");
	} catch (error) {
		if (failureCode === "APPROVAL_WAIT_FAILED" && error instanceof Error &&
			(error.name === "WorkflowTimeoutError" || error.message.startsWith("WorkflowTimeoutError:"))) failureCode = "APPROVAL_TIMEOUT";
		try {
			await step.do("record workflow failure", async () => {
				await stub.markError(failureCode, activeStep);
			});
		} catch {
			// Preserve the engine failure even if the status service is unavailable.
			console.error("Workflow status persistence failed", { instanceId: event.instanceId, failureCode });
		}
		throw error;
	}
}

export class ShionPipelineWorkflow extends WorkflowEntrypoint<Env, Record<string, unknown>> {
	async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
		return runPipeline(this.env, event, step);
	}
}
