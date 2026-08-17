const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function insertSecurityEvent(db, event) {
	return db
		.prepare(
			`INSERT INTO security_events
				(timestamp, client_id, endpoint, request_method, status, reason)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			event.timestamp,
			event.clientIdentifier,
			event.endpoint,
			event.method,
			event.status,
			event.reason,
		)
		.run();
}

export function getLatestSecurityEvents(db, limit = DEFAULT_LIMIT) {
	const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_LIMIT) : DEFAULT_LIMIT;

	return db
		.prepare(
			`SELECT id, timestamp, client_id, endpoint, request_method, status, reason
			 FROM security_events
			 ORDER BY timestamp DESC, id DESC
			 LIMIT ?`,
		)
		.bind(safeLimit)
		.all();
}

export function countAllowedRequests(db) {
	return db
		.prepare("SELECT COUNT(*) AS count FROM security_events WHERE status = 'ALLOWED'")
		.first("count");
}

export function countBlockedRequests(db) {
	return db
		.prepare("SELECT COUNT(*) AS count FROM security_events WHERE status = 'BLOCKED'")
		.first("count");
}

export function groupBlockedRequestsByReason(db) {
	return db
		.prepare(
			`SELECT reason, COUNT(*) AS count
			 FROM security_events
			 WHERE status = 'BLOCKED'
			 GROUP BY reason
			 ORDER BY count DESC, reason ASC`,
		)
		.all();
}
