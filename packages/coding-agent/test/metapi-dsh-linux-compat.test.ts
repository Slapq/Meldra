import { describe, expect, it } from "vitest";
import { assertDshProfileRuntimeSupported } from "../src/metapi/dsh-profile-runtime-provider.ts";

describe("DSH standalone runtime compatibility", () => {
	it("rejects the Linux Bun archive with an actionable error", () => {
		expect(() => assertDshProfileRuntimeSupported({ bunBinary: true, platform: "linux" })).toThrow(
			/unsupported in the standalone Linux Bun archive.*Node\.js source distribution/,
		);
	});

	it.each([
		{ bunBinary: false, platform: "linux" as const },
		{ bunBinary: true, platform: "win32" as const },
		{ bunBinary: true, platform: "darwin" as const },
	])("preserves $platform with bunBinary=$bunBinary", ({ bunBinary, platform }) => {
		expect(() => assertDshProfileRuntimeSupported({ bunBinary, platform })).not.toThrow();
	});
});
