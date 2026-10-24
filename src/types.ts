/**
 * Shared TypeScript types for the Workflows starter template
 */

export type StepStatus =
	| "pending"
	| "running"
	| "waiting"
	| "completed"
	| "error";
export type WorkflowStatus = "idle" | "running" | "completed" | "error";

export interface StepDefinition {
	id: string;
	name: string;
	description: string;
	lineRange: [number, number];
}

export interface WorkflowState {
	instanceId: string | null;
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: WorkflowStatus;
	wsConnected: boolean;
}

export interface WorkflowUpdateMessage {
	type: "workflow_update";
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: "running" | "completed" | "error";
	timestamp: number;
}

// Step definitions for the Shion AV content pipeline workflow
export const WORKFLOW_STEPS: StepDefinition[] = [
	{
		id: "ingest-media",
		name: "ingest media",
		description: "Validate and ingest the uploaded audio/video file",
		lineRange: [3, 7],
	},
	{
		id: "transcode",
		name: "transcode & normalize",
		description: "Transcode to delivery formats and normalize audio",
		lineRange: [9, 10],
	},
	{
		id: "wait-for-approval",
		name: "wait for editorial approval",
		description: "Pause for an editor to review and approve the cut",
		lineRange: [12, 16],
	},
	{
		id: "publish",
		name: "publish to channels",
		description: "Distribute the approved content to all channels",
		lineRange: [18, 22],
	},
];
