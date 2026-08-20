export interface DshRequestEvidence {
	seq: number;
	time?: number;
	reason?: string;
	config?: Record<string, unknown>;
	adapterDefaults?: Record<string, unknown>;
	system?: string;
	tools?: unknown[];
}

export interface DshContextInjectionEvidence {
	seq: number;
	time?: number;
	source: Record<string, unknown>;
	content: Record<string, unknown>[];
}

export interface DshContextEvidence {
	scannedPages: number;
	scannedEvents: number;
	truncated: boolean;
	latestRequest?: DshRequestEvidence;
	contextInjections: DshContextInjectionEvidence[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	const result: Record<string, unknown>[] = [];
	for (const item of value) {
		const valueRecord = record(item);
		if (valueRecord) result.push(valueRecord);
	}
	return result;
}

export function collectDshContextEvidence(
	entries: readonly Record<string, unknown>[],
	scan: { pages: number; truncated: boolean },
): DshContextEvidence {
	const events = entries
		.flatMap((entry) => {
			const event = record(entry.event);
			return typeof event?.seq === "number" ? [event] : [];
		})
		.sort((left, right) => Number(right.seq) - Number(left.seq));
	let latestRequest: DshRequestEvidence | undefined;
	const contextInjections: DshContextInjectionEvidence[] = [];
	for (const event of events) {
		const seq = event.seq as number;
		const data = record(event.data);
		if (!latestRequest && event.type === "request/header") {
			const header = record(data?.header);
			if (header) {
				const config = record(header.config);
				const adapterDefaults = record(header.adapterDefaults);
				latestRequest = {
					seq,
					...(typeof event.time === "number" ? { time: event.time } : {}),
					...(typeof data?.reason === "string" ? { reason: data.reason } : {}),
					...(config ? { config } : {}),
					...(adapterDefaults ? { adapterDefaults } : {}),
					...(typeof header.system === "string" ? { system: header.system } : {}),
					...(Array.isArray(header.tools) ? { tools: header.tools } : {}),
				};
			}
		}
		if (event.type !== "user/message") continue;
		const message = record(data?.message) ?? data;
		const source = record(message?.source);
		if (!source || source.kind === "user") continue;
		contextInjections.push({
			seq,
			...(typeof event.time === "number" ? { time: event.time } : {}),
			source,
			content: records(message?.content),
		});
	}
	return {
		scannedPages: scan.pages,
		scannedEvents: events.length,
		truncated: scan.truncated,
		...(latestRequest ? { latestRequest } : {}),
		contextInjections,
	};
}
