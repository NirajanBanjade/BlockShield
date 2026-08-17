export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

function timestampInMilliseconds(timestamp) {
	if (typeof timestamp !== "string" || timestamp.trim() === "") {
		return Number.NaN;
	}

	if (/^\d+$/.test(timestamp)) {
		const numericTimestamp = Number(timestamp);
		return timestamp.length <= 10 ? numericTimestamp * 1000 : numericTimestamp;
	}

	return Date.parse(timestamp);
}

export function isTimestampFresh(timestamp, now = Date.now(), windowMs = DEFAULT_REPLAY_WINDOW_MS) {
	const requestTime = timestampInMilliseconds(timestamp);

	return Number.isFinite(requestTime) && Math.abs(now - requestTime) <= windowMs;
}
