const encoder = new TextEncoder();
const HEX_SIGNATURE = /^(?:sha256=)?([a-f\d]{64})$/i;

function signatureBytes(signature) {
	if (typeof signature !== "string") {
		return null;
	}

	const match = signature.match(HEX_SIGNATURE);
	if (!match) {
		return null;
	}

	return Uint8Array.from(match[1].match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

export async function verifyHmac(body, timestamp, signature, secret) {
	if (
		typeof body !== "string" ||
		typeof timestamp !== "string" ||
		timestamp.length === 0 ||
		typeof secret !== "string" ||
		secret.length === 0
	) {
		return false;
	}

	const suppliedSignature = signatureBytes(signature);
	if (!suppliedSignature) {
		return false;
	}

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);

	return crypto.subtle.verify(
		"HMAC",
		key,
		suppliedSignature,
		encoder.encode(timestamp + body),
	);
}
