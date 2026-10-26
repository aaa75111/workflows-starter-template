import { useEffect, useReducer } from "react";

/**
 * State and WebSocket hook for the Shion AV content pipeline preview demo.
 *
 * Deliberately a separate hook (not a generalized version of
 * useWorkflowWebSocket) so the default starter demo's hook, message type
 * ("workflow_update") and /ws endpoint stay exactly as they are. This hook
 * talks to the isolated /ws/av endpoint and expects "av_workflow_update"
 * messages from worker/av-durable-object.ts.
 *
 * Its status types are intentionally local (not a widened version of
 * src/types.ts's StepStatus/WorkflowStatus): this demo needs a "rejected"
 * status the default demo's shared components (WorkflowDiagram,
 * CodeDisplay) don't - and don't need to - know about.
 */

export const AV_STEP_NAMES = [
	"ingest media",
	"transcode & normalize",
	"wait for editorial approval",
	"publish to channels",
] as const;

export type AvStepStatus =
	| "pending"
	| "running"
	| "waiting"
	| "completed"
	| "rejected"
	| "error";
export type AvOverallStatus =
	| "idle"
	| "running"
	| "completed"
	| "rejected"
	| "error";

export interface AvWorkflowState {
	instanceId: string | null;
	currentStep: string | null;
	stepStatuses: Record<string, AvStepStatus>;
	workflowStatus: AvOverallStatus;
	errorMessage: string | null;
	wsConnected: boolean;
}

interface AvWorkflowUpdateMessage {
	type: "av_workflow_update";
	currentStep: string | null;
	stepStatuses: Record<string, AvStepStatus>;
	workflowStatus: AvOverallStatus;
	errorMessage: string | null;
	timestamp: number;
}

type Action =
	| { type: "CONNECTED"; instanceId: string }
	| { type: "DISCONNECTED" }
	| { type: "UPDATE"; payload: AvWorkflowUpdateMessage }
	| { type: "RESET" };

const initialState: AvWorkflowState = {
	instanceId: null,
	currentStep: null,
	stepStatuses: Object.fromEntries(
		AV_STEP_NAMES.map((name) => [name, "pending" as AvStepStatus]),
	),
	workflowStatus: "idle",
	errorMessage: null,
	wsConnected: false,
};

function reducer(state: AvWorkflowState, action: Action): AvWorkflowState {
	switch (action.type) {
		case "CONNECTED":
			return { ...state, instanceId: action.instanceId, wsConnected: true };

		case "DISCONNECTED":
			return { ...state, wsConnected: false };

		case "UPDATE":
			return {
				...state,
				currentStep: action.payload.currentStep,
				stepStatuses: action.payload.stepStatuses,
				workflowStatus: action.payload.workflowStatus,
				errorMessage: action.payload.errorMessage,
			};

		case "RESET":
			return { ...initialState };

		default:
			return state;
	}
}

export function useAvWorkflowWebSocket(
	instanceId: string | null,
): AvWorkflowState {
	const [state, dispatch] = useReducer(reducer, initialState);

	useEffect(() => {
		if (!instanceId) {
			dispatch({ type: "RESET" });
			return;
		}

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws/av?instanceId=${encodeURIComponent(instanceId)}`;
		let disposed = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		let retryDelay = 1000;
		let ws: WebSocket;
		dispatch({ type: "RESET" });

		const connect = () => {
			if (disposed) return;
			ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				if (disposed) return;
				retryDelay = 1000;
				dispatch({ type: "CONNECTED", instanceId });
			};

			ws.onclose = () => {
				if (disposed) return;
				dispatch({ type: "DISCONNECTED" });
				retryTimer = setTimeout(connect, retryDelay);
				retryDelay = Math.min(retryDelay * 2, 30000);
			};

			ws.onerror = () => {
				// Connection errors handled by onclose
			};

			ws.onmessage = (event) => {
				if (disposed) return;
				try {
					const data = JSON.parse(event.data);

					if (data.type === "av_workflow_update") {
						dispatch({ type: "UPDATE", payload: data });
					}
				} catch {
					// Ignore malformed messages
				}
			};
		};
		connect();

		return () => {
			disposed = true;
			clearTimeout(retryTimer);
			ws.close();
		};
	}, [instanceId]);

	return state;
}
