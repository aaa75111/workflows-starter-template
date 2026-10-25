export type ApprovalFailure = "INVALID_APPROVAL" | "APPROVAL_REJECTED";

export function approvalFailure(payload: unknown): ApprovalFailure | null {
	if (
		typeof payload !== "object" ||
		payload === null ||
		Array.isArray(payload) ||
		!Object.hasOwn(payload, "approved") ||
		typeof (payload as { approved: unknown }).approved !== "boolean" ||
		("comment" in payload && typeof payload.comment !== "string")
	) {
		return "INVALID_APPROVAL";
	}

	return (payload as { approved: boolean }).approved === true
		? null
		: "APPROVAL_REJECTED";
}

export function isWorkflowTimeout(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "WorkflowTimeoutError" ||
			error.message.startsWith("WorkflowTimeoutError:"))
	);
}
