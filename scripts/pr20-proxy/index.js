// Local-only entry point; do not deploy this proxy.
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/__target") return Response.json({ target: "workflows-starter-template-pr20-staging" });
		return env.TARGET.fetch(request);
	},
};
