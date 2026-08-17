import { afterEach, describe, expect, it, vi } from "vitest";
import providerManager, {
	providerManagerTestInternals as internals,
} from "../examples/extensions/provider-manager-package/extensions/provider-manager.ts";

describe("provider manager example", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("registers the provider command", () => {
		const registerCommand = vi.fn();
		providerManager({ registerCommand } as never);
		expect(registerCommand).toHaveBeenCalledWith(
			"provider",
			expect.objectContaining({ description: "Manage custom providers and models" }),
		);
	});

	it("classifies rich and ID-only model metadata", () => {
		expect(internals.metadataFromRaw({ id: "id-only" })?.rich).toBe(false);
		expect(
			internals.metadataFromRaw({
				id: "rich",
				context_window: 128000,
				input_modalities: ["text", "image"],
			})?.rich,
		).toBe(true);
	});

	it("removes credential query values from displayed discovery URLs", () => {
		expect(internals.safeDiscoveryUrl("https://example.test/v1/models?key=secret-value")).toBe(
			"https://example.test/v1/models",
		);
	});

	it("does not expose a query credential in discovery errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("denied", { status: 401 })),
		);
		await expect(
			internals.discoverModels({
				baseUrl: "https://example.test/v1",
				api: "google-generative-ai",
				apiKey: "secret-value",
				headers: {},
				authHeader: false,
			}),
		).rejects.not.toThrow(/secret-value/);
	});

	it("honors caller cancellation", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string | URL | Request, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
							once: true,
						});
					}),
			),
		);
		const controller = new AbortController();
		const discovery = internals.discoverModels(
			{
				baseUrl: "https://example.test/v1",
				api: "openai-completions",
				apiKey: "",
				headers: {},
				authHeader: false,
			},
			controller.signal,
		);
		controller.abort();
		await expect(discovery).rejects.toMatchObject({ name: "AbortError" });
	});
});
