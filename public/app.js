const form = document.querySelector("#analyze-form");
const input = document.querySelector("#numbers");
const button = form.querySelector("button");
const errorMessage = document.querySelector("#error");
const results = document.querySelector("#results");
const turnstileWidget = document.querySelector("#turnstile-widget");
let turnstileWidgetId;

initializeTurnstile();

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	errorMessage.hidden = true;
	results.hidden = true;

	const values = input.value.split(",").map((value) => value.trim());
	const numbers = values.map(Number);
	const turnstileToken = window.turnstile?.getResponse(turnstileWidgetId);

	if (values.some((value) => value === "") || numbers.some((number) => !Number.isFinite(number))) {
		showError("Enter valid numbers separated by commas.");
		return;
	}

	if (!turnstileToken) {
		showError("Complete the security check before analyzing.");
		return;
	}

	button.disabled = true;
	button.textContent = "Analyzing…";

	try {
		const response = await fetch("/api/analyze", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ numbers, turnstileToken }),
		});
		const data = await response.json();

		if (!response.ok) {
			throw new Error(data.error || "Analysis failed.");
		}

		for (const key of ["count", "sum", "average", "min", "max"]) {
			document.querySelector(`#${key}`).textContent = data[key];
		}

		results.hidden = false;
	} catch (error) {
		showError(error.message || "Unable to reach the analyzer.");
	} finally {
		window.turnstile?.reset(turnstileWidgetId);
		button.disabled = false;
		button.textContent = "Analyze";
	}
});

function showError(message) {
	errorMessage.textContent = message;
	errorMessage.hidden = false;
}

async function initializeTurnstile() {
	try {
		const response = await fetch("/api/config");
		const config = await response.json();

		if (!response.ok || !config.turnstileSiteKey) {
			throw new Error("Security check configuration is unavailable.");
		}

		await waitForTurnstile();
		turnstileWidgetId = window.turnstile.render(turnstileWidget, {
			sitekey: config.turnstileSiteKey,
			action: "analyze",
			theme: "auto",
		});
	} catch (error) {
		button.disabled = true;
		showError(error.message || "Unable to load the security check.");
	}
}

function waitForTurnstile() {
	return new Promise((resolve) => {
		if (window.turnstile) {
			resolve();
			return;
		}

		const interval = window.setInterval(() => {
			if (window.turnstile) {
				window.clearInterval(interval);
				resolve();
			}
		}, 50);
	});
}
