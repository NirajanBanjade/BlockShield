export const SECURITY_REASONS = Object.freeze({
	ALLOWED: "ALLOWED",
	TURNSTILE_FAILED: "TURNSTILE_FAILED",
	INVALID_API_KEY: "INVALID_API_KEY",
	INVALID_SIGNATURE: "INVALID_SIGNATURE",
	REPLAY_DETECTED: "REPLAY_DETECTED",
	RATE_LIMITED: "RATE_LIMITED",
	INVALID_INPUT: "INVALID_INPUT",
});

export function createSecurityEvent({ clientIdentifier, endpoint, method, status, reason }) {
	return {
		timestamp: new Date().toISOString(),
		clientIdentifier,
		endpoint,
		method,
		status,
		reason,
	};
}

export async function sendSecurityEvent(queue, eventData) {
	const event = createSecurityEvent(eventData);
	await queue.send(event);
	return event;
}
