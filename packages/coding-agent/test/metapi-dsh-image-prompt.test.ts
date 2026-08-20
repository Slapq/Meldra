import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import type { ProfileAgentRuntimeHost } from "../src/core/profile-agent-runtime.ts";
import { DSH_MESSAGE_ENTRY, DshProfileRuntime } from "../src/meldra/dsh-profile-runtime.ts";

interface PromptRuntimeInternals {
	runtime: {
		harness: {
			client: { request(): Promise<unknown> };
			close(): Promise<void>;
		};
		sessionId: string;
		eventCursors: Map<"mux" | "host", string>;
		eventTasks: Promise<void>[];
	};
	call: ReturnType<typeof vi.fn>;
	handleRuntimeFrame(active: PromptRuntimeInternals["runtime"], payload: Record<string, unknown>): void;
}

describe("DSH image prompts", () => {
	it("forwards Pi image bytes through native session.prompt without duplicating them in the Pi snapshot", async () => {
		const appended: Array<{ customType: string; data: unknown }> = [];
		const runtime = new DshProfileRuntime({
			cwd: "C:/work",
			agentDir: "C:/profile/agent",
			modelRuntime: {} as ModelRuntime,
		});
		runtime.attach({
			cwd: "C:/work",
			sessionId: "pi-session",
			appendEntry: (customType, data) => appended.push({ customType, data }),
			emit: vi.fn(),
		} satisfies ProfileAgentRuntimeHost);
		const internals = runtime as unknown as PromptRuntimeInternals;
		internals.runtime = {
			harness: {
				client: { request: vi.fn(async () => undefined) },
				close: vi.fn(async () => undefined),
			},
			sessionId: "dsh-session",
			eventCursors: new Map(),
			eventTasks: [],
		};
		internals.call = vi.fn(async () => ({
			result: {
				ok: true,
				value: { accepted: true, command: { kind: "success" } },
			},
		}));

		await runtime.prompt({
			text: "Inspect this image",
			images: [{ type: "image", mimeType: "image/png", data: "cG5nLWJ5dGVz" }],
		});

		expect(internals.call).toHaveBeenCalledWith("session.prompt", {
			sessionId: "dsh-session",
			mode: "queue",
			content: [
				{ type: "text", text: "Inspect this image" },
				{ type: "image", mediaType: "image/png", data: "cG5nLWJ5dGVz" },
			],
		});
		expect(appended).toEqual([]);
		internals.handleRuntimeFrame(internals.runtime, {
			type: "session/event",
			sessionId: "dsh-session",
			event: {
				type: "user/message",
				data: {
					id: "message-1",
					source: { kind: "user", rpcId: "prompt-1" },
					content: [
						{ type: "text", text: "Inspect this image" },
						{ type: "image", attachment: { attachmentId: "image-1" } },
					],
				},
			},
		});
		expect(appended).toEqual([
			{
				customType: DSH_MESSAGE_ENTRY,
				data: { kind: "user", text: "Inspect this image\n[1 image]" },
			},
		]);
		expect(JSON.stringify(appended)).not.toContain("cG5nLWJ5dGVz");
	});
});
