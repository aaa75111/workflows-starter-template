const AV_STEPS = ["ingest media", "transcode & normalize", "wait for editorial approval", "publish to channels"];

export interface LegacyAvSnapshot {
	stepStatuses: Record<string, "pending" | "running" | "waiting" | "completed" | "error">;
	currentStep: string | null;
	workflowStatus: "running" | "completed" | "error";
}

export function isLegacyAvSnapshot(value: unknown): value is LegacyAvSnapshot {
	if (!value || typeof value !== "object" || !("stepStatuses" in value) ||
		!value.stepStatuses || typeof value.stepStatuses !== "object") return false;
	const entries = Object.entries(value.stepStatuses);
	if (!entries.some(([key]) => AV_STEPS.includes(key))) return false;
	if (entries.length !== AV_STEPS.length || entries.some(([key, status]) =>
		!AV_STEPS.includes(key) || !["pending", "running", "waiting", "completed", "error"].includes(status)) ||
		!("workflowStatus" in value) || !["running", "completed", "error"].includes(String(value.workflowStatus)) ||
		!("currentStep" in value) || (value.currentStep !== null && !AV_STEPS.includes(String(value.currentStep)))) {
		throw new Error("Mixed or unknown AV snapshot requires review");
	}
	return true;
}

export async function readLegacyAvSnapshot(env: Env, id: string) {
	const old = env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(id));
	const snapshot = await old.getStateMessage();
	return isLegacyAvSnapshot(snapshot) ? snapshot : null;
}

export async function prepareAvStatus(env: Env, id: string) {
	const stub = env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(id));
	const snapshot = await readLegacyAvSnapshot(env, id);
	if (snapshot) await stub.importLegacySnapshot(snapshot);
	return stub;
}

export function approvalFailure(payload: unknown): string | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload) ||
		!Object.hasOwn(payload, "approved") || !("approved" in payload) || typeof payload.approved !== "boolean" ||
		("comment" in payload && typeof payload.comment !== "string")) return "INVALID_APPROVAL";
	return payload.approved === true ? null : "APPROVAL_REJECTED";
}
