import { DurableObject } from "cloudflare:workers";

/**
 * Provision the v2 namespace without activating PR #16's application code.
 * No HTTP route or existing Workflow calls this object. Keep it inert until
 * the separately reviewed AV implementation is promoted into this namespace.
 */
export class AvWorkflowStatusDO extends DurableObject {
	async fetch(): Promise<Response> {
		return Response.json({ error: "AV pipeline upgrade is not active" }, { status: 503 });
	}
}
