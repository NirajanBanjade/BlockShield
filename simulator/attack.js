#!/usr/bin/env node

"use strict";

const { createHmac } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

loadDevVars();

const MODES = new Set([
	"burst",
	"invalid-key",
	"bad-signature",
	"missing-signature",
	"stale-timestamp",
	"replay",
	"invalid-json",
	"invalid-input",
	"method-not-allowed",
]);

const mode = process.argv[2];
const baseUrl = (process.env.BLOCKSHIELD_URL || "http://localhost:8787").replace(/\/$/, "");
const endpoint = `${baseUrl}/api/v1/analyze`;
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;

if (mode === "--help" || mode === "-h" || mode === undefined) {
	printUsage();
	process.exitCode = 0;
} else if (!MODES.has(mode)) {
	console.error(`Unknown mode: ${mode}\n`);
	printUsage();
	process.exitCode = 1;
} else {
	run(mode).catch((error) => {
		console.error(`Simulator failed: ${error.message}`);
		process.exitCode = 1;
	});
}

async function run(selectedMode) {
	if (needsApiKey(selectedMode) && !apiKey) {
		throw new Error("API_KEY is required. Set it in .dev.vars or the environment.");
	}

	if (needsApiSecret(selectedMode) && !apiSecret) {
		throw new Error("API_SECRET is required. Set it in .dev.vars or the environment.");
	}

	console.log(`Target: ${endpoint}`);
	console.log(`Mode: ${selectedMode}\n`);

	switch (selectedMode) {
		case "burst":
			await burst();
			break;
		case "invalid-key":
			await printResponse(
				"Invalid API key",
				await signedRequest({ key: "definitely-not-a-valid-api-key", secret: "unused" }),
			);
			break;
		case "bad-signature":
			await printResponse(
				"Invalid signature",
				await signedRequest({ signature: "0".repeat(64) }),
			);
			break;
		case "missing-signature":
			await printResponse("Missing signature", await signedRequest({ signature: null }));
			break;
		case "stale-timestamp":
			await printResponse(
				"Stale timestamp",
				await signedRequest({ timestamp: unixTimestamp(-301) }),
			);
			break;
		case "replay":
			await replay();
			break;
		case "invalid-json":
			await printResponse("Invalid JSON", await signedRequest({ body: '{"numbers": [1, 2]' }));
			break;
		case "invalid-input":
			await printResponse(
				"Invalid input",
				await signedRequest({ body: JSON.stringify({ numbers: [] }) }),
			);
			break;
		case "method-not-allowed":
			await printResponse("Wrong HTTP method", await fetch(endpoint));
			break;
	}
}

async function burst() {
	const count = positiveInteger(process.env.BLOCKSHIELD_BURST_COUNT, 25);
	let allowed = 0;
	let rateLimited = 0;
	let other = 0;

	console.log(`Sending ${count} valid signed requests sequentially...\n`);

	for (let requestNumber = 1; requestNumber <= count; requestNumber += 1) {
		const response = await signedRequest();
		if (response.status === 200) allowed += 1;
		else if (response.status === 429) rateLimited += 1;
		else other += 1;

		console.log(`Request ${String(requestNumber).padStart(2)} -> ${response.status} ${statusLabel(response.status)}`);
	}

	console.log("\nSummary");
	console.log(`Allowed:      ${allowed}`);
	console.log(`Rate limited: ${rateLimited}`);
	console.log(`Other:        ${other}`);
}

async function replay() {
	const body = JSON.stringify({ numbers: [10, 20, 30] });
	const timestamp = unixTimestamp();
	const signature = sign(timestamp, body, apiSecret);
	const request = { body, timestamp, signature };

	console.log("Reusing the exact same body, timestamp, and signature:\n");
	await printResponse("Original request", await signedRequest(request));
	await printResponse("Immediate replay", await signedRequest(request));

	const staleTimestamp = unixTimestamp(-301);
	await printResponse(
		"Replay after timestamp window",
		await signedRequest({
			body,
			timestamp: staleTimestamp,
			signature: sign(staleTimestamp, body, apiSecret),
		}),
	);

	console.log("\nAn immediate 200 response demonstrates that timestamp freshness alone does not prevent replay.");
}

async function signedRequest({
	body = JSON.stringify({ numbers: [10, 20, 30] }),
	timestamp = unixTimestamp(),
	signature,
	key = apiKey,
	secret = apiSecret,
} = {}) {
	const headers = {
		"Content-Type": "application/json",
		"X-API-Key": key,
		"X-Timestamp": timestamp,
	};

	const resolvedSignature = signature === undefined ? sign(timestamp, body, secret) : signature;
	if (resolvedSignature !== null) headers["X-Signature"] = resolvedSignature;

	return fetch(endpoint, { method: "POST", headers, body });
}

function sign(timestamp, body, secret) {
	return createHmac("sha256", secret).update(timestamp + body).digest("hex");
}

function unixTimestamp(offsetSeconds = 0) {
	return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

async function printResponse(label, response) {
	const responseBody = await response.text();
	console.log(`${label}: ${response.status} ${statusLabel(response.status)}`);
	if (responseBody) console.log(`  ${responseBody}`);
}

function statusLabel(status) {
	return {
		200: "OK",
		400: "BAD REQUEST",
		401: "UNAUTHORIZED",
		403: "FORBIDDEN",
		405: "METHOD NOT ALLOWED",
		429: "RATE LIMITED",
	}[status] || "UNEXPECTED RESPONSE";
}

function needsApiKey(selectedMode) {
	return !["invalid-key", "method-not-allowed"].includes(selectedMode);
}

function needsApiSecret(selectedMode) {
	return !["invalid-key", "bad-signature", "missing-signature", "method-not-allowed"].includes(
		selectedMode,
	);
}

function positiveInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDevVars() {
	const path = resolve(process.cwd(), ".dev.vars");
	if (!existsSync(path)) return;

	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (!match || match[2] === "") continue;

		const [, name, rawValue] = match;
		if (process.env[name] !== undefined) continue;

		const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
		process.env[name] = quoted ? (quoted[1] ?? quoted[2]) : rawValue;
	}
}

function printUsage() {
	console.log(`Usage: npm run simulate -- <mode>\n
Modes:
  burst              Send valid requests until the rate limiter responds
  invalid-key         Send an incorrect API key
  bad-signature       Send an invalid HMAC signature
  missing-signature   Omit the HMAC signature
  stale-timestamp     Sign a request with an expired timestamp
  replay              Reuse an identical signed request, then try a stale one
  invalid-json        Sign and send malformed JSON
  invalid-input       Sign and send an empty numbers array
  method-not-allowed  Send GET to the POST-only developer endpoint

Configuration:
  API_KEY                 Defaults to the value in .dev.vars
  API_SECRET              Defaults to the value in .dev.vars
  BLOCKSHIELD_URL          Defaults to http://localhost:8787
  BLOCKSHIELD_BURST_COUNT  Defaults to 25`);
}
