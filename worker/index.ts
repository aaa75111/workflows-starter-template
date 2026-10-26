import { approvalFailure } from "./approval";

// Export the Workflow and Durable Object classes
export { ShionPipelineWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";

/**
 * Main Worker fetch handler
 *
 * Handles API routes and WebSocket upgrade requests for the Shion AV
 * content pipeline workflow:
 * - POST /api/workflow/start - Create new workflow instance
 * - GET /api/workflow/status/:id - Get workflow status
 * - POST /api/workflow/event/:id - Send events to workflow
 * - GET /ws - WebSocket connection for real-time updates
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API: Start a new workflow instance
		if (url.pathname === "/api/workflow/start" && request.method === "POST") {
			try {
				const instance = await env.SHION_WORKFLOW.create({
					params: {
						timestamp: Date.now(),
					},
				});

				return Response.json({
					instanceId: instance.id,
					message: "Workflow started successfully",
				});
			} catch {
				return Response.json(
					{ error: "Failed to start workflow" },
					{ status: 500 },
				);
			}
		}

		// API: Get workflow status
		if (url.pathname.startsWith("/api/workflow/status/")) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const instance = await env.SHION_WORKFLOW.get(instanceId);
				const status = await instance.status();
				return Response.json(status);
			} catch {
				return Response.json(
					{ error: "Failed to get workflow status" },
					{ status: 500 },
				);
			}
		}

		// API: Send event to workflow instance
		if (
			url.pathname.startsWith("/api/workflow/event/") &&
			request.method === "POST"
		) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const body: unknown = await request.json();
				if (approvalFailure(body) === "INVALID_APPROVAL") {
					return Response.json(
						{ error: "approved must be a boolean" },
						{ status: 400 },
					);
				}

				const stub = env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(instanceId));
				// Only the executing gated Workflow writes this marker. An HTTP
				// start response or a copied legacy snapshot cannot establish it.
				if (!(await stub.hasApprovalGate())) {
					return Response.json({
						error: "Legacy or unverified workflow requires manual review",
						code: "LEGACY_INSTANCE_REQUIRES_REVIEW",
					}, { status: 409 });
				}
				const instance = await env.SHION_WORKFLOW.get(instanceId);
				const state = await instance.status();
				if (["complete", "errored", "terminated"].includes(state.status)) {
					return Response.json({ error: "Workflow is already stopped" }, { status: 409 });
				}

				await instance.sendEvent({
					type: "editorial-approval",
					payload: body,
				});

				return Response.json({
					success: true,
					message: "Event sent successfully",
				});
			} catch (error) {
				return Response.json(
					{ error: "Failed to send event" },
					{ status: error instanceof SyntaxError ? 400 : 500 },
				);
			}
		}

		// WebSocket: Connect to workflow status updates
		if (url.pathname === "/ws") {
			const instanceId = url.searchParams.get("instanceId");
			if (!instanceId) {
				return new Response("instanceId query parameter required", {
					status: 400,
				});
			}

			const upgradeHeader = request.headers.get("Upgrade");
			if (upgradeHeader !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			try {
				const doId = env.WORKFLOW_STATUS.idFromName(instanceId);
				const stub = env.WORKFLOW_STATUS.get(doId);
				return stub.fetch(request);
			} catch {
				return new Response("Failed to establish WebSocket connection", {
					status: 500,
				});
			}
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
