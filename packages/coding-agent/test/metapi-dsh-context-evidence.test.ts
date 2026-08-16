import { describe, expect, it, vi } from "vitest";
import { collectDshContextEvidence } from "../src/metapi/dsh-context-evidence.ts";
import { DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";

describe("DSH context evidence", () => {
	it("collects the latest real request header and durable context injections", () => {
		const evidence = collectDshContextEvidence(
			[
				{
					event: {
						seq: 4,
						time: 40,
						type: "request/header",
						data: {
							reason: "change",
							header: {
								config: { provider: "deepseek", model: "v4" },
								system: "latest system",
								tools: [{ name: "read" }],
							},
						},
					},
				},
				{
					event: {
						seq: 3,
						type: "user/message",
						data: {
							message: {
								source: {
									kind: "agent-instructions",
									changes: [{ path: "AGENTS.md", action: "loaded" }],
								},
								content: [{ type: "text", text: "workspace rules" }],
							},
						},
					},
				},
				{
					event: {
						seq: 2,
						type: "request/header",
						data: { header: { config: { provider: "old", model: "old" } } },
					},
				},
			],
			{ pages: 2, truncated: false },
		);

		expect(evidence.latestRequest).toMatchObject({
			seq: 4,
			reason: "change",
			system: "latest system",
			tools: [{ name: "read" }],
		});
		expect(evidence.contextInjections).toEqual([
			expect.objectContaining({
				seq: 3,
				source: expect.objectContaining({ kind: "agent-instructions" }),
				content: [{ type: "text", text: "workspace rules" }],
			}),
		]);
	});

	it("scans native history pages with an authoritative bound", async () => {
		const runtime = Object.create(DshProfileRuntime.prototype) as DshProfileRuntime;
		runtime.history = vi
			.fn()
			.mockResolvedValueOnce({
				events: [{ event: { seq: 8, type: "assistant/message", data: {} } }],
				hasMore: true,
			})
			.mockResolvedValueOnce({
				events: [
					{
						event: {
							seq: 7,
							type: "request/header",
							data: {
								header: { config: { provider: "p", model: "m" } },
							},
						},
					},
				],
				hasMore: false,
			});

		const evidence = await runtime.contextEvidence();

		expect(runtime.history).toHaveBeenNthCalledWith(1, undefined);
		expect(runtime.history).toHaveBeenNthCalledWith(2, 8);
		expect(evidence).toMatchObject({
			scannedPages: 2,
			scannedEvents: 2,
			truncated: false,
			latestRequest: { seq: 7 },
		});
	});
});
