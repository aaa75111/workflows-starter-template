import { env, SELF, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("additive AV namespace bootstrap", () => {
	it("leaves the new object inert and preserves both namespaces' stored data", async () => {
		const id = crypto.randomUUID();
		const old = env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(id));
		const added = env.AV_WORKFLOW_STATUS.get(env.AV_WORKFLOW_STATUS.idFromName(id));
		await old.updateStep("wait for editorial approval", "waiting");
		let original: Map<string, unknown>;
		await runInDurableObject(old, async (_object, state) => { original = await state.storage.list(); });
		await runInDurableObject(added, async (_object, state) => {
			expect((await state.storage.list()).size).toBe(0);
			await state.storage.put("existing-av-data", { preserve: true });
		});
		await evictDurableObject(added);
		for (const method of ["GET", "POST"]) {
			const response = await added.fetch("https://bootstrap/", { method });
			expect(response.status).toBe(503);
		}
		await runInDurableObject(added, async (_object, state) => {
			expect([...await state.storage.list()]).toEqual([["existing-av-data", { preserve: true }]]);
		});
		await evictDurableObject(old);
		await runInDurableObject(old, async (_object, state) => {
			expect(await state.storage.list()).toEqual(original);
		});
	});

	it("does not activate the new AV routes during the bootstrap", async () => {
		for (const [path, method] of [
			["/api/av/workflow/start", "POST"],
			["/api/av/workflow/event/example", "POST"],
			["/api/av/workflow/status/example", "GET"],
			["/ws/av?instanceId=example", "GET"],
		]) {
			const response = await SELF.fetch(`https://test${path}`, { method });
			expect(response.status).toBe(404);
		}
	});
});
