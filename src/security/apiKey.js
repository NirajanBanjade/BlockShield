const encoder = new TextEncoder();

function equalStrings(left, right) {
	if (typeof left !== "string" || typeof right !== "string") {
		return false;
	}

	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length);
	let difference = leftBytes.length ^ rightBytes.length;

	for (let index = 0; index < length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}

	return difference === 0;
}

export function verifyApiKey(request, validApiKey) {
	return equalStrings(request.headers.get("X-API-Key"), validApiKey);
}
