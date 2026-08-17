import { analyze } from "./compute/analyzer.js";
import { sendSecurityEvent, SECURITY_REASONS } from "./events/securityEvent.js";
import { consumeSecurityEvents } from "./queue/consumer.js";
import { verifyApiKey } from "./security/apiKey.js";
import { verifyHmac } from "./security/hmac.js";
import { isTimestampFresh } from "./security/replay.js";
import { verifyTurnstile } from "./security/turnstile.js";

export { RateLimiter } from "./rate-limit/RateLimiter.js";

function jsonResponse(data, status = 200) {
	return Response.json(data, { status });
}

function publishSecurityEvent(request, env, clientIdentifier, status, reason) {
	return sendSecurityEvent(env.SECURITY_EVENTS, {
		clientIdentifier,
		endpoint: new URL(request.url).pathname,
		method: request.method,
		status,
		reason,
	});
}

async function applyRateLimit(request, env, clientId, eventClientIdentifier) {
	const rateLimiter = env.RATE_LIMITER.getByName(clientId);
	const rateLimit = await rateLimiter.check();

	if (rateLimit.allowed) {
		return null;
	}

	await publishSecurityEvent(
		request,
		env,
		eventClientIdentifier,
		"BLOCKED",
		SECURITY_REASONS.RATE_LIMITED,
	);

	return Response.json(
		{
			error: "Rate limit exceeded",
			remaining: rateLimit.remaining,
			retryAfter: rateLimit.retryAfter,
		},
		{
			status: 429,
			headers: {
				"RateLimit-Remaining": String(rateLimit.remaining),
				"Retry-After": String(rateLimit.retryAfter),
			},
		},
	);
}

async function analyzeBody(request, env, body, clientIdentifier) {
	try {
		const result = analyze(body?.numbers);
		await publishSecurityEvent(request, env, clientIdentifier, "ALLOWED", SECURITY_REASONS.ALLOWED);
		return jsonResponse(result);
	} catch (error) {
		if (error instanceof TypeError) {
			await publishSecurityEvent(
				request,
				env,
				clientIdentifier,
				"BLOCKED",
				SECURITY_REASONS.INVALID_INPUT,
			);
			return jsonResponse({ error: error.message }, 400);
		}

		throw error;
	}
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		if (pathname === "/api/config") {
			if (request.method !== "GET") {
				return jsonResponse({ error: "Method not allowed" }, 405);
			}

			return jsonResponse({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
		}

		if (pathname === "/") {
			if (request.method !== "GET") {
				return jsonResponse({ error: "Method not allowed" }, 405);
			}

			return new Response("EdgeShield API is running");
		}

		if (pathname === "/api/analyze" || pathname === "/api/v1/analyze") {
			if (request.method !== "POST") {
				return jsonResponse({ error: "Method not allowed" }, 405);
			}

			if (pathname === "/api/v1/analyze") {
				const clientIdentifier = "developer-api";

				if (!verifyApiKey(request, env.API_KEY)) {
					await publishSecurityEvent(
						request,
						env,
						clientIdentifier,
						"BLOCKED",
						SECURITY_REASONS.INVALID_API_KEY,
					);
					return jsonResponse({ error: "Invalid API key" }, 401);
				}

				const timestamp = request.headers.get("X-Timestamp");
				const signature = request.headers.get("X-Signature");
				const rawBody = await request.text();

				if (!isTimestampFresh(timestamp)) {
					await publishSecurityEvent(
						request,
						env,
						clientIdentifier,
						"BLOCKED",
						SECURITY_REASONS.REPLAY_DETECTED,
					);
					return jsonResponse({ error: "Request timestamp is outside the allowed window" }, 401);
				}

				if (!(await verifyHmac(rawBody, timestamp, signature, env.API_SECRET))) {
					await publishSecurityEvent(
						request,
						env,
						clientIdentifier,
						"BLOCKED",
						SECURITY_REASONS.INVALID_SIGNATURE,
					);
					return jsonResponse({ error: "Invalid signature" }, 401);
				}

				let body;
				try {
					body = JSON.parse(rawBody);
				} catch {
					await publishSecurityEvent(
						request,
						env,
						clientIdentifier,
						"BLOCKED",
						SECURITY_REASONS.INVALID_INPUT,
					);
					return jsonResponse({ error: "Invalid JSON" }, 400);
				}

				const rateLimitResponse = await applyRateLimit(
					request,
					env,
					`api:${env.API_KEY}`,
					clientIdentifier,
				);
				return rateLimitResponse ?? (await analyzeBody(request, env, body, clientIdentifier));
			}

			const clientIdentifier = request.headers.get("CF-Connecting-IP") || "local-client";

			let body;

			try {
				body = await request.json();
			} catch {
				await publishSecurityEvent(
					request,
					env,
					clientIdentifier,
					"BLOCKED",
					SECURITY_REASONS.INVALID_INPUT,
				);
				return jsonResponse({ error: "Invalid JSON" }, 400);
			}

			const turnstileValid = await verifyTurnstile(
				body?.turnstileToken,
				env.TURNSTILE_SECRET,
				request.headers.get("CF-Connecting-IP"),
				env.TURNSTILE_EXPECTED_HOSTNAME,
				env.TURNSTILE_EXPECTED_ACTION,
			);

			if (!turnstileValid) {
				await publishSecurityEvent(
					request,
					env,
					clientIdentifier,
					"BLOCKED",
					SECURITY_REASONS.TURNSTILE_FAILED,
				);
				return jsonResponse({ error: "Turnstile verification failed" }, 403);
			}

			const rateLimitResponse = await applyRateLimit(
				request,
				env,
				`browser:${clientIdentifier}`,
				clientIdentifier,
			);
			return rateLimitResponse ?? (await analyzeBody(request, env, body, clientIdentifier));
		}

		return jsonResponse({ error: "Not found" }, 404);
	},

	async queue(batch, env) {
		await consumeSecurityEvents(batch, env.DB);
	},
};
