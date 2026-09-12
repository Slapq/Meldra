/**
 * Tests for Sixel graphics support:
 * - PNG decoding to RGBA
 * - box-filter resizing
 * - median-cut quantization
 * - Sixel encoding
 * - terminal capability detection for Sixel-capable terminals
 */

import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { decodePngToRgba, encodeSixelFromPngBase64, quantizeRgba, resizeRgba } from "../src/sixel.ts";
import {
	calculateImageCellSize,
	detectCapabilities,
	isImageLine,
	renderImage,
	resetCapabilitiesCache,
	setCellDimensions,
} from "../src/terminal-image.ts";

// ── PNG fixture helpers ──────────────────────────────────────────────────────

let crcTable: number[] | undefined;

function crc32(buffer: Buffer): number {
	if (!crcTable) {
		crcTable = [];
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
	const chunk = Buffer.alloc(12 + body.length);
	chunk.writeUInt32BE(body.length, 0);
	chunk.write(type, 4, "ascii");
	body.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
	return chunk;
}

/** Build a minimal non-interlaced RGBA 8-bit PNG from raw pixel bytes. */
function makeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

// ── Environment helpers ──────────────────────────────────────────────────────

const ENV_KEYS = [
	"TERM",
	"TERM_PROGRAM",
	"TERMINAL_EMULATOR",
	"COLORTERM",
	"TMUX",
	"KITTY_WINDOW_ID",
	"GHOSTTY_RESOURCES_DIR",
	"WEZTERM_PANE",
	"WARP_SESSION_ID",
	"WARP_TERMINAL_SESSION_UUID",
	"Iterm_SESSION_ID",
	"ITERM_SESSION_ID",
	"WT_SESSION",
	"PI_TUI_IMAGE_PROTOCOL",
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
	const saved: Record<string, string | undefined> = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		if (overrides[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = overrides[key];
		}
	}
	try {
		fn();
	} finally {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	}
}

afterEach(() => {
	resetCapabilitiesCache();
});

// ── PNG decoding ─────────────────────────────────────────────────────────────

describe("decodePngToRgba", () => {
	it("decodes an 8-bit RGBA PNG", () => {
		// 2x1: red, semi-transparent green (composited onto black)
		const png = makeRgbaPng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]));
		const image = decodePngToRgba(png);
		assert.ok(image);
		assert.strictEqual(image.width, 2);
		assert.strictEqual(image.height, 1);
		assert.deepStrictEqual(Array.from(image.pixels), [255, 0, 0, 255, 0, 128, 0, 255]);
	});

	it("rejects non-PNG data", () => {
		assert.strictEqual(decodePngToRgba(Buffer.from("not a png")), null);
		assert.strictEqual(decodePngToRgba(Buffer.alloc(0)), null);
	});
});

// ── Resizing ─────────────────────────────────────────────────────────────────

describe("resizeRgba", () => {
	it("returns the input unchanged at identical size", () => {
		const image = { width: 2, height: 2, pixels: new Uint8Array(16).fill(7) };
		assert.strictEqual(resizeRgba(image, 2, 2), image);
	});

	it("box-averages when downscaling", () => {
		// 2x1 image: left black, right white -> 1x1 becomes mid-gray
		const pixels = new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255]);
		const resized = resizeRgba({ width: 2, height: 1, pixels }, 1, 1);
		assert.strictEqual(resized.width, 1);
		assert.strictEqual(resized.height, 1);
		assert.strictEqual(resized.pixels[0], 100); // (0 + 200) / 2
	});
});

// ── Quantization ─────────────────────────────────────────────────────────────

describe("quantizeRgba", () => {
	it("produces valid indices within palette bounds", () => {
		const width = 32;
		const height = 32;
		const pixels = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			pixels[i * 4] = (i * 7) % 256;
			pixels[i * 4 + 1] = (i * 13) % 256;
			pixels[i * 4 + 2] = (i * 29) % 256;
			pixels[i * 4 + 3] = 255;
		}
		const { palette, indices } = quantizeRgba({ width, height, pixels });
		assert.ok(palette.length > 0);
		assert.ok(palette.length <= 256);
		assert.strictEqual(indices.length, width * height);
		for (const index of indices) {
			assert.ok(index < palette.length);
		}
	});

	it("keeps a small exact palette lossless in count", () => {
		// Two distinct colors only
		const pixels = new Uint8Array([10, 20, 30, 255, 200, 210, 220, 255]);
		const { palette } = quantizeRgba({ width: 2, height: 1, pixels });
		assert.strictEqual(palette.length, 2);
	});
});

// ── Sixel encoding pipeline ──────────────────────────────────────────────────

describe("encodeSixelFromPngBase64", () => {
	it("produces a well-formed Sixel DCS sequence", () => {
		const png = makeRgbaPng(4, 4, new Uint8Array(4 * 4 * 4).fill(90));
		const base64 = png.toString("base64");
		const sequence = encodeSixelFromPngBase64(base64, 8, 12);
		assert.ok(sequence);
		assert.ok(sequence.startsWith("\x1bPq"));
		assert.ok(sequence.includes('"1;1;8;12')); // raster attributes
		assert.ok(sequence.endsWith("\x1b\\"));
		// Color definition present (0-100 scale)
		assert.ok(/#\d+;\d*;?\d*;2;\d+;\d+;\d+/.test(sequence) || sequence.includes(";2;"));
	});

	it("returns null for undecodable input", () => {
		assert.strictEqual(encodeSixelFromPngBase64(Buffer.from("junk").toString("base64"), 8, 8), null);
	});
});

// ── Terminal detection ───────────────────────────────────────────────────────

describe("detectCapabilities sixel", () => {
	it("treats Windows Terminal (WT_SESSION) as sixel-capable", () => {
		withEnv({ WT_SESSION: "some-guid" }, () => {
			const caps = detectCapabilities();
			assert.strictEqual(caps.images, "sixel");
			assert.strictEqual(caps.trueColor, true);
			assert.strictEqual(caps.hyperlinks, true);
		});
	});

	it("PI_TUI_IMAGE_PROTOCOL=none disables images on Windows Terminal", () => {
		withEnv({ WT_SESSION: "some-guid", PI_TUI_IMAGE_PROTOCOL: "none" }, () => {
			assert.strictEqual(detectCapabilities().images, null);
		});
	});

	it("PI_TUI_IMAGE_PROTOCOL=sixel forces sixel elsewhere", () => {
		withEnv({ PI_TUI_IMAGE_PROTOCOL: "sixel" }, () => {
			assert.strictEqual(detectCapabilities().images, "sixel");
		});
	});

	it("plain Windows consoles stay imageless", () => {
		withEnv({}, () => {
			// Simulate win32 without WT_SESSION by relying on platform; skip on
			// non-Windows CI where isWindowsConsole is false and result differs.
			if (process.platform !== "win32") return;
			assert.strictEqual(detectCapabilities().images, null);
		});
	});
});

// ── Line classification and rendering integration ────────────────────────────

describe("isImageLine with sixel", () => {
	it("recognizes lines that contain a Sixel sequence", () => {
		assert.ok(isImageLine('\x1bPq"1;1;8;12#0;2;0;0;100~~~~\x1b\\'));
		assert.ok(isImageLine(`\x1b[3A${encodeSample()}`));
		assert.ok(!isImageLine("plain text line"));
	});

	function encodeSample(): string {
		return `\x1bPq"1;1;2;6#0;2;0;0;0~!4-\x1b\\`;
	}
});

describe("renderImage sixel branch", () => {
	it("renders a PNG as a Sixel sequence sized to cells", () => {
		withEnv({ WT_SESSION: "some-guid" }, () => {
			setCellDimensions({ widthPx: 9, heightPx: 18 });
			resetCapabilitiesCache();
			const png = makeRgbaPng(9, 36, new Uint8Array(9 * 36 * 4).fill(120));
			const size = calculateImageCellSize({ widthPx: 9, heightPx: 36 }, 40, undefined, {
				widthPx: 9,
				heightPx: 18,
			});
			const result = renderImage(
				png.toString("base64"),
				{ widthPx: 9, heightPx: 36 },
				{
					maxWidthCells: 40,
				},
			);
			assert.ok(result);
			assert.strictEqual(result.columns, size.columns);
			assert.strictEqual(result.rows, size.rows);
			assert.ok(result.sequence.startsWith("\x1bPq"));
			assert.ok(result.sequence.endsWith("\x1b\\"));
		});
	});

	it("falls back to null for non-PNG data under sixel", () => {
		withEnv({ WT_SESSION: "some-guid" }, () => {
			resetCapabilitiesCache();
			const jpegLike = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
			assert.strictEqual(renderImage(jpegLike.toString("base64"), { widthPx: 10, heightPx: 10 }, {}), null);
		});
	});
});
