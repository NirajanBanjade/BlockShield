import { DurableObject } from "cloudflare:workers";

const REQUEST_LIMIT = 10;
const WINDOW_MS = 60_000;

export class RateLimiter extends DurableObject {
	async check() {
		const now = Date.now();
		let window = await this.ctx.storage.get("window");

		if (!window || now >= window.startedAt + WINDOW_MS) {
			window = { count: 0, startedAt: now };
		}

		window.count += 1;
		await this.ctx.storage.put("window", window);

		const allowed = window.count <= REQUEST_LIMIT;
		const retryAfter = allowed
			? 0
			: Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000));

		return {
			allowed,
			remaining: Math.max(0, REQUEST_LIMIT - window.count),
			retryAfter,
		};
	}
}
