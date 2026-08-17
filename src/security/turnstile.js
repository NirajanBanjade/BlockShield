const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token, secret, remoteIp, expectedHostname, expectedAction) {
	if (typeof token !== "string" || token.length === 0 || token.length > 2048 || !secret) {
		return false;
	}

	try {
		const formData = new FormData();
		formData.append("secret", secret);
		formData.append("response", token);

		if (remoteIp) {
			formData.append("remoteip", remoteIp);
		}

		const response = await fetch(SITEVERIFY_URL, {
			method: "POST",
			body: formData,
		});

		if (!response.ok) {
			return false;
		}

		const validation = await response.json();
		if (validation.success !== true) {
			return false;
		}

		if (expectedHostname && validation.hostname !== expectedHostname) {
			return false;
		}

		if (expectedAction && validation.action !== expectedAction) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}
