import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import schema from "../migrations/0001_create_security_events.sql?raw";
import {
	countAllowedRequests,
	countBlockedRequests,
	getLatestSecurityEvents,
	groupBlockedRequestsByReason,
} from "../src/db/events.js";
import { createSecurityEvent, SECURITY_REASONS } from "../src/events/securityEvent.js";
import { consumeSecurityEvents } from "../src/queue/consumer.js";
import worker from "../src";

const SITEVERIFY_ORIGIN = "https://challenges.cloudflare.com";
const TURNSTILE_HOSTNAME = "example.com";
const TURNSTILE_ACTION = "analyze";

beforeAll(async () => {
	const statements = schema
		.split(";")
		.map((statement) => statement.trim())
		.filter(Boolean)
		.map((statement) => env.DB.prepare(statement));
	await env.DB.batch(statements);
});

describe("security events", () => {
	it("creates a consistent event shape", () => {
		const event = createSecurityEvent({
			clientIdentifier: "client-123",
			endpoint: "/api/v1/analyze",
			method: "POST",
			status: "BLOCKED",
			reason: SECURITY_REASONS.INVALID_SIGNATURE,
		});

		expect(event).toEqual({
			timestamp: expect.any(String),
			clientIdentifier: "client-123",
			endpoint: "/api/v1/analyze",
			method: "POST",
			status: "BLOCKED",
			reason: "INVALID_SIGNATURE",
		});
		expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
	});

	it("persists a consumed batch and supports security summaries", async () => {
		const allowed = createSecurityEvent({
			clientIdentifier: "client-123",
			endpoint: "/api/v1/analyze",
			method: "POST",
			status: "ALLOWED",
			reason: SECURITY_REASONS.ALLOWED,
		});
		const blocked = createSecurityEvent({
			clientIdentifier: "client-123",
			endpoint: "/api/v1/analyze",
			method: "POST",
			status: "BLOCKED",
			reason: SECURITY_REASONS.INVALID_SIGNATURE,
		});

		await consumeSecurityEvents(
			{ messages: [{ body: allowed }, { body: blocked }] },
			env.DB,
		);

		expect(await countAllowedRequests(env.DB)).toBe(1);
		expect(await countBlockedRequests(env.DB)).toBe(1);
		expect((await getLatestSecurityEvents(env.DB)).results).toHaveLength(2);
		expect((await groupBlockedRequestsByReason(env.DB)).results).toEqual([
			{ reason: "INVALID_SIGNATURE", count: 1 },
		]);
	});
});

describe("GET /api/config", () => {
	it("returns only the public Turnstile site key", async () => {
		const response = await worker.fetch(new Request("http://example.com/api/config"), {
			TURNSTILE_SITE_KEY: "public-site-key",
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ turnstileSiteKey: "public-site-key" });
	});
});

describe("POST /api/analyze", () => {
	beforeAll(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.assertNoPendingInterceptors());

	it("blocks a missing Turnstile token", async () => {
		const response = await worker.fetch(
			new Request("http://example.com/api/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ numbers: [10, 20] }),
			}),
			{ TURNSTILE_SECRET: "secret", SECURITY_EVENTS: env.SECURITY_EVENTS },
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Turnstile verification failed" });
	});

	it("blocks an invalid Turnstile token", async () => {
		fetchMock
			.get(SITEVERIFY_ORIGIN)
			.intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
			.reply(200, { success: false });

		const response = await analyzeRequest("invalid-token");

		expect(response.status).toBe(403);
	});

	it("analyzes numbers after valid Turnstile verification", async () => {
		fetchMock
			.get(SITEVERIFY_ORIGIN)
			.intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
			.reply(200, {
				success: true,
				hostname: TURNSTILE_HOSTNAME,
				action: TURNSTILE_ACTION,
			});

		const response = await analyzeRequest("valid-token", "test-valid-client");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			count: 2,
			sum: 30,
			average: 15,
			min: 10,
			max: 20,
		});
	});

	it("blocks a token issued for a different hostname", async () => {
		fetchMock
			.get(SITEVERIFY_ORIGIN)
			.intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
			.reply(200, {
				success: true,
				hostname: "attacker.example",
				action: TURNSTILE_ACTION,
			});

		const response = await analyzeRequest("wrong-hostname-token", "wrong-hostname-client");

		expect(response.status).toBe(403);
	});

	it("blocks the eleventh request from the same client", async () => {
		fetchMock
			.get(SITEVERIFY_ORIGIN)
			.intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
			.reply(200, {
				success: true,
				hostname: TURNSTILE_HOSTNAME,
				action: TURNSTILE_ACTION,
			})
			.times(11);

		let response;

		for (let requestNumber = 1; requestNumber <= 11; requestNumber += 1) {
			response = await analyzeRequest(`valid-token-${requestNumber}`, "rate-limit-client");
			expect(response.status).toBe(requestNumber <= 10 ? 200 : 429);
		}

		expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
		expect(await response.json()).toMatchObject({
			error: "Rate limit exceeded",
			remaining: 0,
		});
	});
});

describe("POST /api/v1/analyze", () => {
	it("rejects a missing API key before checking the signature", async () => {
		const response = await developerRequest({ apiKey: null });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Invalid API key" });
	});

	it("rejects an invalid signature", async () => {
		const response = await developerRequest({ signature: "0".repeat(64) });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Invalid signature" });
	});

	it("rejects a correctly signed request with a stale timestamp", async () => {
		const response = await developerRequest({
			timestamp: String(Math.floor(Date.now() / 1000) - 301),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: "Request timestamp is outside the allowed window",
		});
	});

	it("analyzes a valid signed request", async () => {
		const response = await developerRequest();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			count: 2,
			sum: 30,
			average: 15,
			min: 10,
			max: 20,
		});
	});
});

function analyzeRequest(turnstileToken, clientId = "default-test-client") {
	return worker.fetch(
		new Request("http://example.com/api/analyze", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": clientId,
			},
			body: JSON.stringify({ numbers: [10, 20], turnstileToken }),
		}),
		{
			TURNSTILE_SECRET: "secret",
			TURNSTILE_EXPECTED_HOSTNAME: TURNSTILE_HOSTNAME,
			TURNSTILE_EXPECTED_ACTION: TURNSTILE_ACTION,
			RATE_LIMITER: env.RATE_LIMITER,
			SECURITY_EVENTS: env.SECURITY_EVENTS,
		},
	);
}

async function developerRequest({
	apiKey = "demo-api-key",
	timestamp = String(Math.floor(Date.now() / 1000)),
	signature,
} = {}) {
	const body = JSON.stringify({ numbers: [10, 20] });
	const headers = {
		"Content-Type": "application/json",
		"X-Timestamp": timestamp,
	};

	if (apiKey !== null) {
		headers["X-API-Key"] = apiKey;
	}

	headers["X-Signature"] = signature ?? (await sign(timestamp + body, "demo-api-secret"));

	return worker.fetch(
		new Request("http://example.com/api/v1/analyze", {
			method: "POST",
			headers,
			body,
		}),
		{
			API_KEY: "demo-api-key",
			API_SECRET: "demo-api-secret",
			RATE_LIMITER: env.RATE_LIMITER,
			SECURITY_EVENTS: env.SECURITY_EVENTS,
		},
	);
}

async function sign(message, secret) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
