import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the real hook's effect/reducer with a deterministic browser and
// clock. No sockets, Cloudflare credentials, or wall-clock sleeps are needed.
const source = readFileSync(new URL("../src/hooks/useAvWorkflowWebSocket.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
	let state;
	let effect;
	const sockets = [];
	const timers = new Map();
	let nextTimer = 0;
	class Socket {
		constructor(url) { this.url = url; sockets.push(this); }
		close() { this.onclose?.(); }
	}
	const exports = {};
	runInNewContext(code, {
		exports,
		require: name => {
			assert.equal(name, "react");
			return {
				useReducer: (reducer, initial) => {
					state ??= initial;
					return [state, action => { state = reducer(state, action); }];
				},
				useEffect: callback => { effect = callback; },
			};
		},
		window: { location: { protocol: "https:", host: "example.test" } },
		WebSocket: Socket,
		setTimeout: (callback, delay) => {
			const id = ++nextTimer;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimeout: id => timers.delete(id),
	});
	return {
		sockets, timers,
		get state() { return state; },
		mount(id) { exports.useAvWorkflowWebSocket(id); return effect(); },
		retry() {
			const [id, timer] = timers.entries().next().value;
			timers.delete(id);
			timer.callback();
			return timer.delay;
		},
	};
}

test("reconnects to the same instance and receives its durable terminal snapshot", () => {
	const h = harness();
	const stop = h.mount("one&two");
	const first = h.sockets[0];
	assert.equal(first.url, "wss://example.test/ws/av?instanceId=one%26two");
	first.onopen();
	assert.equal(h.state.instanceId, "one&two");
	first.close();
	assert.equal(h.state.wsConnected, false);
	assert.equal(h.retry(), 1000);
	const second = h.sockets[1];
	assert.equal(second.url, first.url);
	second.onopen();
	second.onmessage({ data: JSON.stringify({ type: "av_workflow_update", currentStep: null,
		stepStatuses: {}, workflowStatus: "rejected", errorMessage: "APPROVAL_REJECTED" }) });
	assert.equal(h.state.workflowStatus, "rejected");
	assert.equal(h.state.wsConnected, true);
	stop();
	assert.equal(h.timers.size, 0);
});

test("backs off failed connections to 30 seconds and resets after an open", () => {
	const h = harness();
	const stop = h.mount("one");
	for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
		h.sockets.at(-1).close();
		assert.equal(h.retry(), expected);
	}
	h.sockets.at(-1).onopen();
	h.sockets.at(-1).close();
	assert.equal(h.retry(), 1000);
	stop();
});

test("reset cancels retry and ignores delayed callbacks from the old instance", () => {
	const h = harness();
	const stop = h.mount("old");
	const old = h.sockets[0];
	old.onopen();
	old.close();
	const delayedRetry = [...h.timers.values()][0].callback;
	stop();
	assert.equal(h.timers.size, 0);
	h.mount("new");
	h.sockets[1].onopen();
	old.onopen();
	old.onmessage({ data: JSON.stringify({ type: "av_workflow_update", workflowStatus: "completed" }) });
	old.close();
	delayedRetry();
	assert.equal(h.state.instanceId, "new");
	assert.equal(h.state.workflowStatus, "idle");
	assert.equal(h.state.wsConnected, true);
	assert.equal(h.timers.size, 0);
	assert.equal(h.sockets.length, 2);
});
