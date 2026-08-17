CREATE TABLE IF NOT EXISTS security_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timestamp TEXT NOT NULL,
	client_id TEXT NOT NULL,
	endpoint TEXT NOT NULL,
	request_method TEXT NOT NULL,
	status TEXT NOT NULL,
	reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_timestamp
	ON security_events (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_status_reason
	ON security_events (status, reason);
