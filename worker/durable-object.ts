import { DurableObject } from "cloudflare:workers";

type StoredStepStatus =
	| "pending"
	| "running"
	| "waiting"
	| "completed"
	| "rejected"
	| "error";
type StoredWorkflowStatus = "running" | "completed" | "rejected" | "error";

const GENERIC_STEPS = [
	"process data",
	"wait 2 seconds",
	"wait for approval",
	"final",
] as const;

/**
 * WorkflowStatusDO - Durable Object for managing workflow state and WebSocket connections
 *
 * Responsibilities:
 * - Accept and manage WebSocket connections using hibernation API
 * - Track step statuses for a workflow instance
 * - Broadcast updates to all connected clients
 * - Provide RPC methods for the workflow to update step status or mark a terminal error
 */
export class WorkflowStatusDO extends DurableObject {
	private stepStatuses: Map<string, StoredStepStatus>;
	private currentStep: string | null;
	private workflowStatus: StoredWorkflowStatus;
	private errorMessage: string | null | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.stepStatuses = new Map();
		this.currentStep = null;
		this.workflowStatus = "running";
		this.errorMessage = undefined;

		// Load state from durable storage to survive hibernation/eviction
		ctx.blockConcurrencyWhile(async () => {
			const storedStatuses =
				await ctx.storage.get<Record<string, StoredStepStatus>>("stepStatuses");
			const storedCurrent = await ctx.storage.get<string | null>("currentStep");
			const storedWorkflowStatus =
				await ctx.storage.get<StoredWorkflowStatus>("workflowStatus");
			const storedErrorMessage =
				await ctx.storage.get<string | null>("errorMessage");

			if (storedStatuses) {
				this.stepStatuses = new Map(Object.entries(storedStatuses));
			} else {
				GENERIC_STEPS.forEach((s) => this.stepStatuses.set(s, "pending"));
			}

			this.currentStep = storedCurrent ?? null;
			this.workflowStatus = storedWorkflowStatus ?? "running";
			this.errorMessage = storedErrorMessage;
		});
	}

	// Retain PR #20 RPCs for in-flight workflows still using the original DO.
	// The event router continues quarantining every recognized legacy AV ID.
	// This metadata is deliberately absent from pre-hotfix snapshots.
	async registerApprovalGate(): Promise<void> {
		await this.ctx.storage.put("approvalGateVersion", "strict-editorial-v1");
	}

	async hasApprovalGate(): Promise<boolean> {
		return await this.ctx.storage.get("approvalGateVersion") === "strict-editorial-v1";
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			// Use hibernation API - acceptWebSocket allows the DO to hibernate
			this.ctx.acceptWebSocket(server);

			// Send current state immediately upon connection
			server.send(JSON.stringify(this.getStateMessage()));

			return new Response(null, { status: 101, webSocket: client });
		}

		return new Response("Expected WebSocket", { status: 400 });
	}

	/**
	 * RPC method called by the workflow to update step status
	 * This is called via stub.updateStep() from the workflow
	 */
	async updateStep(stepName: string, status: StoredStepStatus): Promise<void> {
		if (
			this.workflowStatus === "rejected" ||
			this.workflowStatus === "error" ||
			this.workflowStatus === "completed"
		) {
			// A prior storage failure may have left only in-memory terminal state.
			await this.persistAndBroadcast();
			return;
		}

		// Replayed notifications must not regress an already completed step.
		if (this.stepStatuses.get(stepName) === "completed") {
			await this.persistAndBroadcast();
			return;
		}
		this.stepStatuses.set(stepName, status);

		if (status === "running" || status === "waiting") {
			this.currentStep = stepName;
		}

		const allCompleted = Array.from(this.stepStatuses.values()).every(
			(s) => s === "completed",
		);
		if (allCompleted) {
			this.workflowStatus = "completed";
			this.currentStep = null;
		}

		await this.persistAndBroadcast();
	}

	/**
	 * RPC method called when editorial approval is refused, invalid, or times out.
	 * Persists a terminal status so WebSocket clients stop showing "waiting".
	 */
	async markError(message?: string, stepName?: string): Promise<void> {
		if (
			this.workflowStatus === "rejected" ||
			this.workflowStatus === "error" ||
			this.workflowStatus === "completed"
		) {
			// A prior storage failure may have left only in-memory terminal state.
			await this.persistAndBroadcast();
			return;
		}

		const rejected = message === "APPROVAL_REJECTED";
		this.workflowStatus = rejected ? "rejected" : "error";
		if (stepName) {
			this.stepStatuses.set(stepName, rejected ? "rejected" : "error");
		}
		if (rejected) {
			this.stepStatuses.set("publish to channels", "rejected");
		}
		this.errorMessage = message ?? null;
		this.currentStep = null;

		await this.persistAndBroadcast();
	}

	/**
	 * WebSocket message handler (hibernation API)
	 * Called when a client sends a message
	 */
	async webSocketMessage(ws: WebSocket, _message: string): Promise<void> {
		ws.send(JSON.stringify(this.getStateMessage()));
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
			...(this.errorMessage === undefined ? {} : { errorMessage: this.errorMessage }),
		});
		this.broadcast(this.getStateMessage());
	}

	/**
	 * Broadcast a message to all connected WebSocket clients
	 */
	private broadcast(message: object): void {
		const sockets = this.ctx.getWebSockets();
		const json = JSON.stringify(message);

		for (const socket of sockets) {
			try {
				socket.send(json);
			} catch {
				// Ignore errors for disconnected sockets
			}
		}
	}

	/**
	 * Get the current state as a message object
	 */
	getStateMessage() {
		return {
			type: "workflow_update",
			currentStep: this.currentStep,
			stepStatuses: Object.fromEntries(this.stepStatuses),
			workflowStatus: this.workflowStatus,
			...(this.errorMessage === undefined ? {} : { errorMessage: this.errorMessage }),
			timestamp: Date.now(),
		};
	}
}
