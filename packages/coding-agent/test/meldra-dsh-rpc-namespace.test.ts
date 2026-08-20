import { describe, expect, it } from "vitest";
import { canonicalMeldraDshRpcMethod } from "../src/extensions/dsh/server.ts";

const RPC_METHOD_SUFFIXES = [
	"api.call",
	"api.respond",
	"commands.list",
	"commands.execute",
	"message-feedback.call",
	"plugin-inventory.list",
	"api.events.open",
	"api.events.next",
	"api.events.close",
] as const;

describe("Meldra DSH RPC namespace", () => {
	it.each(RPC_METHOD_SUFFIXES)("keeps meldra/%s canonical", (suffix) => {
		expect(canonicalMeldraDshRpcMethod(`meldra/${suffix}`)).toBe(`meldra/${suffix}`);
	});

	it.each(RPC_METHOD_SUFFIXES)("maps legacy metapi/%s requests to Meldra", (suffix) => {
		expect(canonicalMeldraDshRpcMethod(`metapi/${suffix}`)).toBe(`meldra/${suffix}`);
	});

	it("leaves Harness-native methods unchanged", () => {
		expect(canonicalMeldraDshRpcMethod("initialize")).toBe("initialize");
		expect(canonicalMeldraDshRpcMethod("session/prompt")).toBe("session/prompt");
		expect(canonicalMeldraDshRpcMethod("shutdown")).toBe("shutdown");
	});
});
