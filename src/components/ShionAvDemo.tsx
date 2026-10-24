import { useState } from "react";
import { useAvWorkflowWebSocket, AV_STEP_NAMES } from "../hooks/useAvWorkflowWebSocket";
import type { AvStepStatus } from "../hooks/useAvWorkflowWebSocket";

/**
 * Shion AV Content Pipeline - preview demo
 *
 * Deliberately a self-contained component, not a reuse of WorkflowDiagram /
 * CodeDisplay: it has its own Approve *and* Reject actions (the shared
 * diagram only wires up Approve) and its own isolated API/WebSocket paths.
 * Nothing in this file is imported by App.tsx's default demo path, and
 * nothing here imports from worker/workflow.ts or worker/durable-object.ts.
 */

const STEP_DESCRIPTIONS: Record<string, string> = {
	"ingest media": "Accept the uploaded audio/video file",
	"transcode & normalize": "Transcode to delivery formats, normalize audio",
	"wait for editorial approval": "Pause until an editor approves or rejects",
	"publish to channels": "Publish only if approved",
};

const STATUS_STYLES: Record<AvStepStatus, string> = {
	pending:
		"bg-neutral-500/10 dark:bg-neutral-500/20 text-neutral-600 dark:text-neutral-300",
	running:
		"bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400",
	waiting:
		"bg-yellow-500/10 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
	completed:
		"bg-green-500/10 dark:bg-green-500/20 text-green-700 dark:text-green-400",
	rejected:
		"bg-red-500/10 dark:bg-red-500/20 text-red-700 dark:text-red-400",
};

export function ShionAvDemo() {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	const [isResponding, setIsResponding] = useState(false);
	const state = useAvWorkflowWebSocket(instanceId);

	const isIdle = state.workflowStatus === "idle" && !isStarting;
	const isTerminal =
		state.workflowStatus === "completed" ||
		state.workflowStatus === "rejected" ||
		state.workflowStatus === "error";

	const handleStart = async () => {
		setIsStarting(true);
		try {
			const response = await fetch("/api/av/workflow/start", {
				method: "POST",
			});
			if (!response.ok) {
				throw new Error("Failed to start workflow");
			}
			const data = await response.json();
			setInstanceId(data.instanceId);
		} catch {
			alert("Failed to start the Shion AV content pipeline demo.");
			setIsStarting(false);
		}
	};

	const handleDecision = async (approved: boolean) => {
		if (!instanceId) return;
		setIsResponding(true);
		try {
			const response = await fetch(`/api/av/workflow/event/${instanceId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					approved,
					comment: approved ? "Approved via UI" : "Rejected via UI",
				}),
			});
			if (!response.ok) {
				throw new Error("Failed to send decision");
			}
		} catch {
			alert("Failed to send the editorial decision. Please try again.");
		} finally {
			setIsResponding(false);
		}
	};

	const handleReset = () => {
		setInstanceId(null);
		setIsStarting(false);
	};

	return (
		<div className="h-full overflow-auto p-4">
			<div className="backdrop-blur-xl bg-white/80 dark:bg-neutral-900/80 rounded-2xl shadow-float ring-glass p-5 flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
							Shion AV Content Pipeline
						</h2>
						<p className="text-xs text-neutral-500 dark:text-neutral-400">
							Preview demo. Ingest/transcode/publish steps are simulated
							(fixed delays, no real media I/O) - isolated from the default
							demo above (separate Workflow, Durable Object and API routes).
						</p>
					</div>
					<button
						onClick={isIdle ? handleStart : isTerminal ? handleReset : undefined}
						disabled={!isIdle && !isTerminal}
						className={`shrink-0 px-3 py-1 text-xs font-medium rounded-md transition-all ${
							isIdle || isTerminal
								? "bg-neutral-900 dark:bg-neutral-800 text-white hover:bg-neutral-700 cursor-pointer"
								: "bg-neutral-200 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500 cursor-not-allowed"
						}`}
					>
						{isTerminal ? "Reset" : "Start"}
					</button>
				</div>

				<ul className="flex flex-col gap-2">
					{AV_STEP_NAMES.map((name) => {
						const status = state.stepStatuses[name] ?? "pending";
						const isCurrent = state.currentStep === name;
						return (
							<li
								key={name}
								className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ${
									isCurrent
										? "ring-blue-400/40 dark:ring-blue-500/40 bg-blue-500/5 dark:bg-blue-500/10"
										: "ring-black/5 dark:ring-white/10"
								}`}
							>
								<div className="flex flex-col gap-0.5 min-w-0">
									<span className="text-sm font-mono font-medium text-neutral-900 dark:text-neutral-100">
										{name}
									</span>
									<span className="text-xs text-neutral-500 dark:text-neutral-400">
										{STEP_DESCRIPTIONS[name]}
									</span>
								</div>
								<span
									className={`shrink-0 px-2 py-1 rounded-md text-xs font-medium ${STATUS_STYLES[status]}`}
								>
									{status}
								</span>
							</li>
						);
					})}
				</ul>

				{state.workflowStatus === "error" && state.errorMessage && (
					<p className="text-xs text-red-700 dark:text-red-400">
						Error: {state.errorMessage}
					</p>
				)}

				{state.currentStep === "wait for editorial approval" && (
					<div className="flex gap-2">
						<button
							onClick={() => handleDecision(true)}
							disabled={isResponding}
							className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-all"
						>
							Approve
						</button>
						<button
							onClick={() => handleDecision(false)}
							disabled={isResponding}
							className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-all"
						>
							Reject
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
