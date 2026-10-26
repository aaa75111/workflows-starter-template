import { DurableObject } from "cloudflare:workers";
import { isLegacyAvSnapshot } from "./av-compatibility";
import type { LegacyAvSnapshot } from "./av-compatibility";

type AvStepStatus = "pending" | "running" | "waiting" | "completed" | "rejected" | "error";
type AvWorkflowStatus = "running" | "completed" | "rejected" | "error";

/**
 * AvWorkflowStatusDO - Durable Object for the Shion AV content pipeline preview
 *
 * Deliberately a separate class/binding from WorkflowStatusDO (not a
 * subclass) so the stable starter demo's Durable Object is never touched by
 * this preview feature - see AGENTS.md and worker/shion-pipeline-workflow.ts.
 *
 * Adds two things the starter demo's DO didn't need:
 * - A "rejected" terminal status (an editorial rejection must stop the
 *   pipeline, not read as still "running").
 * - markError(), so the Workflow can report a timeout/exception as an
 *   overall workflow status without pretending it belongs to one step.
 */
export class AvWorkflowStatusDO extends DurableObject {
	private stepStatuses: Map<string, AvStepStatus>;
	private currentStep: string | null;
	private workflowStatus: AvWorkflowStatus;
	private errorMessage: string | null;
	private hasStoredState = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.stepStatuses = new Map();
		this.currentStep = null;
		this.workflowStatus = "running";
		this.errorMessage = null;

		// Load state from durable storage to survive hibernation/eviction
		ctx.blockConcurrencyWhile(async () => {
			const storedStatuses =
				await ctx.storage.get<Record<string, AvStepStatus>>("stepStatuses");
			const storedCurrent = await ctx.storage.get<string | null>("currentStep");
			const storedWorkflowStatus =
				await ctx.storage.get<AvWorkflowStatus>("workflowStatus");
			const storedErrorMessage =
				await ctx.storage.get<string | null>("errorMessage");

			if (storedStatuses) {
				this.hasStoredState = true;
				this.stepStatuses = new Map(Object.entries(storedStatuses));
			} else {
				const steps = [
					"ingest media",
					"transcode & normalize",
					"wait for editorial approval",
					"publish to channels",
				];
				steps.forEach((s) => this.stepStatuses.set(s, "pending"));
			}

			this.currentStep = storedCurrent ?? null;
			this.workflowStatus = storedWorkflowStatus ?? "running";
			this.errorMessage = storedErrorMessage ?? null;
		});
	}

	// Copy recognized PR #6 snapshots once. Never change the original namespace
	// or overwrite newer isolated state, including a rejected/errored decision.
	async importLegacySnapshot(snapshot: LegacyAvSnapshot): Promise<void> {
		if (this.hasStoredState || !isLegacyAvSnapshot(snapshot)) return;
		this.stepStatuses = new Map(Object.entries(snapshot.stepStatuses));
		this.currentStep = snapshot.currentStep;
		this.workflowStatus = snapshot.workflowStatus;
		this.errorMessage = snapshot.errorMessage ?? null;
		await this.persistAndBroadcast();
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			// Use hibernation API - acceptWebSocket allows the DO to hibernate
			const legacy = new URL(request.url).searchParams.get("legacyProtocol") === "1";
			this.ctx.acceptWebSocket(server, legacy ? ["legacy"] : []);

			// Send current state immediately upon connection
			server.send(JSON.stringify(this.getStateMessage(legacy)));

			return new Response(null, { status: 101, webSocket: client });
		}

		return new Response("Expected WebSocket", { status: 400 });
	}

	/**
	 * RPC method called by the workflow to update step status.
	 * A "rejected" step status is terminal, mirroring how "completed" on the
	 * last step marks the whole workflow completed.
	 */
	async updateStep(stepName: string, status: AvStepStatus): Promise<void> {
		if (!this.stepStatuses.has(stepName)) throw new Error("Unknown AV step");
		if (this.workflowStatus === "rejected" || this.workflowStatus === "error") throw new Error("AV workflow already stopped");
		if (this.workflowStatus === "completed" || this.stepStatuses.get(stepName) === "completed") return;
		this.stepStatuses.set(stepName, status);

		if (status === "running" || status === "waiting") {
			this.currentStep = stepName;
		}

		if (status === "rejected") {
			this.workflowStatus = "rejected";
			this.currentStep = null;
		} else {
			const allCompleted = Array.from(this.stepStatuses.values()).every(
				(s) => s === "completed",
			);
			if (allCompleted) {
				this.workflowStatus = "completed";
				this.currentStep = null;
			}
		}

		await this.persistAndBroadcast();
	}

	/**
	 * RPC method called by the workflow when it errors (e.g. an approval
	 * timeout or an exhausted step retry). Persists the failed step and outcome
	 * atomically; editorial rejection remains distinguishable from other errors.
	 */
	async markError(message?: string, stepName?: string): Promise<void> {
		if (this.workflowStatus === "rejected" || this.workflowStatus === "error") return;
		const rejected = message === "APPROVAL_REJECTED";
		this.workflowStatus = rejected ? "rejected" : "error";
		if (stepName && this.stepStatuses.has(stepName)) this.stepStatuses.set(stepName, rejected ? "rejected" : "error");
		if (rejected) this.stepStatuses.set("publish to channels", "rejected");
		this.errorMessage = message ?? null;
		this.currentStep = null;

		await this.persistAndBroadcast();
	}

	/**
	 * WebSocket message handler (hibernation API)
	 * Called when a client sends a message
	 */
	async webSocketMessage(ws: WebSocket, _message: string): Promise<void> {
		ws.send(JSON.stringify(this.getStateMessage(this.ctx.getTags(ws).includes("legacy"))));
	}

	/**
	 * WebSocket close handler (hibernation API)
	 * Called when a client closes the connection
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		ws.close(code, reason);
	}

	private async persistAndBroadcast(): Promise<void> {
		await this.ctx.storage.put({
			stepStatuses: Object.fromEntries(this.stepStatuses),
			currentStep: this.currentStep,
			workflowStatus: this.workflowStatus,
			errorMessage: this.errorMessage,
		});
		this.hasStoredState = true;
		this.broadcast();
	}

	/**
	 * Broadcast a message to all connected WebSocket clients
	 */
	private broadcast(): void {
		const sockets = this.ctx.getWebSockets();

		for (const socket of sockets) {
			try {
				socket.send(JSON.stringify(this.getStateMessage(this.ctx.getTags(socket).includes("legacy"))));
			} catch {
				// Ignore errors for disconnected sockets
			}
		}
	}

	/**
	 * Get the current state as a message object
	 */
	getStateMessage(legacy = false) {
		return {
			type: legacy ? "workflow_update" : "av_workflow_update",
			currentStep: this.currentStep,
			stepStatuses: Object.fromEntries([...this.stepStatuses].map(([key, value]) => [key, legacy && value === "rejected" ? "error" : value])),
			workflowStatus: legacy && this.workflowStatus === "rejected" ? "error" : this.workflowStatus,
			errorMessage: this.errorMessage,
			timestamp: Date.now(),
		};
	}
}
