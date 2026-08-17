import { insertSecurityEvent } from "../db/events.js";

export async function consumeSecurityEvents(batch, db) {
	for (const message of batch.messages) {
		await insertSecurityEvent(db, message.body);
		console.log(message.body);
	}
}
