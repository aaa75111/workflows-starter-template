// Add the bootstrap binding without regenerating main's pinned runtime types.
declare namespace Cloudflare {
	interface Env {
		AV_WORKFLOW_STATUS: DurableObjectNamespace<import("./av-bootstrap-object").AvWorkflowStatusDO>;
	}
}
