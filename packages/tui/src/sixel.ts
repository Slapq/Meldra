/**
 * Sixel graphics encoder.
 *
 * Unlike the Kitty and iTerm2 protocols (which accept an encoded image file
 * directly), Sixel requires the terminal-independent raster form: the sender
 * must decode the image into raw pixels, rescale it to the target cell
 * geometry, quantize it to at most 256 colors, and emit palette-indexed
 * band data.
 *
 * This module implements a dependency-free pipeline:
 *   PNG (8/16-bit, non-interlaced) -> RGBA -> box-filter resize ->
 *   median-cut quantization (<= 256 colors) -> Sixel DCS sequence.
 *
 * The output is placed at the cursor position and scrolls with the text
 * buffer (same model as iTerm2 inline images).
 */

import { inflateSync } from "node:zlib";

export interface RgbaImage {
	width: number;
	height: number;
	/** RGBA bytes; alpha is pre-composited onto black. */
	pixels: Uint8Array;
}

const PNG_SIGNATURE_1 = 0x89;
const PNG_SIGNATURE_ASCII = "PNG";
const SIXEL_MAX_COLORS = 256;

function paethPredictor(left: number, up: number, upperLeft: number): number {
	const p = left + up - upperLeft;
	const pa = Math.abs(p - left);
	const pb = Math.abs(p - up);
	const pc = Math.abs(p - upperLeft);
	if (pa <= pb && pa <= pc) return left;
	if (pb <= pc) return up;
	return upperLeft;
}

/**
 * Decode a PNG buffer to straight-RGBA pixels with alpha composited onto
 * black (the Sixel output has no alpha channel). Supports color types
 * 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha) and 6 (RGBA) at 8 or 16
 * bits per sample (palette: 8 only), non-interlaced.
 * Returns `null` for anything unsupported or malformed.
 */
export function decodePngToRgba(data: Buffer): RgbaImage | null {
	try {
		if (data.length < 57 || data[0] !== PNG_SIGNATURE_1 || data.toString("ascii", 1, 4) !== PNG_SIGNATURE_ASCII) {
			return null;
		}

		let width = 0;
		let height = 0;
		let bitDepth = 0;
		let colorType = 0;
		let interlace = -1;
		let palette: Buffer | null = null;
		let trns: Buffer | null = null;
		const idat: Buffer[] = [];

		let offset = 8;
		while (offset + 12 <= data.length) {
			const length = data.readUInt32BE(offset);
			const type = data.toString("ascii", offset + 4, offset + 8);
			const bodyStart = offset + 8;
			const chunkEnd = bodyStart + length + 4; // + CRC
			if (chunkEnd > data.length) return null;
			const body = data.subarray(bodyStart, bodyStart + length);

			if (type === "IHDR") {
				if (length < 13) return null;
				width = body.readUInt32BE(0);
				height = body.readUInt32BE(4);
				bitDepth = body[8];
				colorType = body[9];
				const compression = body[10];
				const filterMethod = body[11];
				interlace = body[12];
				if (compression !== 0 || filterMethod !== 0) return null;
			} else if (type === "PLTE") {
				palette = Buffer.from(body);
			} else if (type === "tRNS") {
				trns = Buffer.from(body);
			} else if (type === "IDAT") {
				idat.push(Buffer.from(body));
			} else if (type === "IEND") {
				break;
			}
			offset = chunkEnd;
		}

		if (width === 0 || height === 0 || idat.length === 0 || interlace !== 0) return null;

		let channels: number;
		switch (colorType) {
			case 0:
				channels = 1;
				break;
			case 2:
				channels = 3;
				break;
			case 3:
				channels = 1;
				break;
			case 4:
				channels = 2;
				break;
			case 6:
				channels = 4;
				break;
			default:
				return null;
		}
		if (colorType === 3 ? bitDepth !== 8 : bitDepth !== 8 && bitDepth !== 16) return null;
		if (colorType === 3 && (!palette || palette.length < 3)) return null;

		const bytesPerSample = bitDepth === 16 ? 2 : 1;
		const bpp = channels * bytesPerSample;
		const stride = width * bpp;

		let raw: Buffer;
		try {
			raw = inflateSync(Buffer.concat(idat));
		} catch {
			return null;
		}
		if (raw.length < (stride + 1) * height) return null;

		// Undo per-scanline filters in place.
		const unfiltered = Buffer.alloc(stride * height);
		for (let y = 0; y < height; y++) {
			const filter = raw[y * (stride + 1)];
			const srcStart = y * (stride + 1) + 1;
			const rowStart = y * stride;
			const prevStart = rowStart - stride;
			for (let x = 0; x < stride; x++) {
				const value = raw[srcStart + x];
				const left = x >= bpp ? unfiltered[rowStart + x - bpp] : 0;
				const up = y > 0 ? unfiltered[prevStart + x] : 0;
				const upperLeft = y > 0 && x >= bpp ? unfiltered[prevStart + x - bpp] : 0;
				let reconstructed: number;
				switch (filter) {
					case 0:
						reconstructed = value;
						break;
					case 1:
						reconstructed = value + left;
						break;
					case 2:
						reconstructed = value + up;
						break;
					case 3:
						reconstructed = value + ((left + up) >> 1);
						break;
					case 4:
						reconstructed = value + paethPredictor(left, up, upperLeft);
						break;
					default:
						return null;
				}
				unfiltered[rowStart + x] = reconstructed & 0xff;
			}
		}

		const sample = (base: number, channel: number): number =>
			bitDepth === 16 ? unfiltered.readUInt16BE(base + channel * 2) >> 8 : unfiltered[base + channel];

		const pixels = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			const base = i * bpp;
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 255;
			switch (colorType) {
				case 0:
					r = g = b = sample(base, 0);
					break;
				case 2:
					r = sample(base, 0);
					g = sample(base, 1);
					b = sample(base, 2);
					break;
				case 3: {
					const index = unfiltered[base];
					const plte = palette;
					if (!plte || index * 3 + 2 >= plte.length) return null;
					r = plte[index * 3];
					g = plte[index * 3 + 1];
					b = plte[index * 3 + 2];
					a = trns && index < trns.length ? trns[index] : 255;
					break;
				}
				case 4:
					r = g = b = sample(base, 0);
					a = sample(base, 1);
					break;
				case 6:
					r = sample(base, 0);
					g = sample(base, 1);
					b = sample(base, 2);
					a = sample(base, 3);
					break;
			}
			if (a !== 255) {
				r = Math.round((r * a) / 255);
				g = Math.round((g * a) / 255);
				b = Math.round((b * a) / 255);
			}
			pixels[i * 4] = r;
			pixels[i * 4 + 1] = g;
			pixels[i * 4 + 2] = b;
			pixels[i * 4 + 3] = 255;
		}
		return { width, height, pixels };
	} catch {
		return null;
	}
}

/** Box-filter (area average) downscale/upscale to the exact target size. */
export function resizeRgba(image: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
	if (image.width === targetWidth && image.height === targetHeight) return image;
	const pixels = new Uint8Array(targetWidth * targetHeight * 4);
	for (let dy = 0; dy < targetHeight; dy++) {
		const sy0 = Math.floor((dy * image.height) / targetHeight);
		const sy1 = Math.min(image.height, Math.max(sy0 + 1, Math.floor(((dy + 1) * image.height) / targetHeight)));
		for (let dx = 0; dx < targetWidth; dx++) {
			const sx0 = Math.floor((dx * image.width) / targetWidth);
			const sx1 = Math.min(image.width, Math.max(sx0 + 1, Math.floor(((dx + 1) * image.width) / targetWidth)));
			let r = 0;
			let g = 0;
			let b = 0;
			let count = 0;
			for (let sy = sy0; sy < sy1; sy++) {
				for (let sx = sx0; sx < sx1; sx++) {
					const o = (sy * image.width + sx) * 4;
					r += image.pixels[o];
					g += image.pixels[o + 1];
					b += image.pixels[o + 2];
					count++;
				}
			}
			const o = (dy * targetWidth + dx) * 4;
			pixels[o] = r / count;
			pixels[o + 1] = g / count;
			pixels[o + 2] = b / count;
			pixels[o + 3] = 255;
		}
	}
	return { width: targetWidth, height: targetHeight, pixels };
}

interface QuantizedImage {
	palette: Array<[number, number, number]>;
	indices: Uint8Array;
}

/**
 * Median-cut color quantization to at most 256 colors, followed by nearest-
 * palette-entry mapping of every pixel (with a 15-bit cache to avoid repeated
 * linear searches for repeated colors).
 */
export function quantizeRgba(image: RgbaImage, maxColors: number = SIXEL_MAX_COLORS): QuantizedImage {
	const pixelCount = image.width * image.height;
	const step = Math.max(1, Math.floor(pixelCount / 32768));
	const samples: number[] = [];
	for (let i = 0; i < pixelCount; i += step) {
		const o = i * 4;
		samples.push((image.pixels[o] << 16) | (image.pixels[o + 1] << 8) | image.pixels[o + 2]);
	}

	let boxes: number[][] = [samples];
	while (boxes.length < maxColors) {
		// Pick the box with the largest channel range that can still split.
		let widestBox = -1;
		let widestRange = 0;
		let widestChannel = 0;
		for (let b = 0; b < boxes.length; b++) {
			const box = boxes[b];
			if (box.length < 2) continue;
			let minR = 255,
				maxR = 0,
				minG = 255,
				maxG = 0,
				minB = 255,
				maxB = 0;
			for (const packed of box) {
				const r = (packed >> 16) & 0xff;
				const g = (packed >> 8) & 0xff;
				const bl = packed & 0xff;
				if (r < minR) minR = r;
				if (r > maxR) maxR = r;
				if (g < minG) minG = g;
				if (g > maxG) maxG = g;
				if (bl < minB) minB = bl;
				if (bl > maxB) maxB = bl;
			}
			const ranges = [maxR - minR, maxG - minG, maxB - minB];
			const channel = ranges.indexOf(Math.max(...ranges));
			if (ranges[channel] > widestRange) {
				widestRange = ranges[channel];
				widestBox = b;
				widestChannel = channel;
			}
		}
		if (widestBox < 0 || widestRange === 0) break;
		const box = boxes[widestBox].sort((a, b) => {
			const shift = (2 - widestChannel) * 8;
			return ((a >> shift) & 0xff) - ((b >> shift) & 0xff);
		});
		const median = box.length >> 1;
		boxes = [...boxes.slice(0, widestBox), box.slice(0, median), box.slice(median), ...boxes.slice(widestBox + 1)];
	}

	const palette: Array<[number, number, number]> = boxes
		.filter((box) => box.length > 0)
		.map((box) => {
			let r = 0;
			let g = 0;
			let b = 0;
			for (const packed of box) {
				r += (packed >> 16) & 0xff;
				g += (packed >> 8) & 0xff;
				b += packed & 0xff;
			}
			return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)] as [
				number,
				number,
				number,
			];
		});

	const indices = new Uint8Array(pixelCount);
	const cache = new Map<number, number>();
	for (let i = 0; i < pixelCount; i++) {
		const o = i * 4;
		const r = image.pixels[o];
		const g = image.pixels[o + 1];
		const b = image.pixels[o + 2];
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		let entry = cache.get(key);
		if (entry === undefined) {
			let bestDistance = Number.POSITIVE_INFINITY;
			entry = 0;
			for (let p = 0; p < palette.length; p++) {
				const dr = r - palette[p][0];
				const dg = g - palette[p][1];
				const db = b - palette[p][2];
				const distance = dr * dr + dg * dg + db * db;
				if (distance < bestDistance) {
					bestDistance = distance;
					entry = p;
				}
			}
			cache.set(key, entry);
		}
		indices[i] = entry;
	}

	return { palette, indices };
}

const SIXEL_COLOR_CHAR_OFFSET = 63; // '?' — bits 0..5 map to band rows top->bottom

/**
 * Encode palette-indexed pixels as a Sixel DCS sequence.
 * The sequence is placed at the cursor position and scrolls with the text
 * buffer. Colors are declared on a 0-100 RGB scale; pixel runs use the `!`
 * repeat operator.
 */
export function encodeSixel(
	indices: Uint8Array,
	width: number,
	height: number,
	palette: Array<[number, number, number]>,
): string {
	const parts: string[] = [`\x1bPq"1;1;${width};${height}`];
	for (let i = 0; i < palette.length; i++) {
		const [r, g, b] = palette[i];
		parts.push(
			`#${i};2;${Math.round((r * 100) / 255)};${Math.round((g * 100) / 255)};${Math.round((b * 100) / 255)}`,
		);
	}

	// Precompute which palette entries each band uses so colors stay grouped.
	for (let bandStart = 0; bandStart < height; bandStart += 6) {
		const bandRows = Math.min(6, height - bandStart);
		const usedColors = new Set<number>();
		for (let y = bandStart; y < bandStart + bandRows; y++) {
			for (let x = 0; x < width; x++) usedColors.add(indices[y * width + x]);
		}
		if (bandStart > 0) parts.push("-");
		let firstColorInBand = true;
		for (const color of usedColors) {
			if (!firstColorInBand) parts.push("$");
			firstColorInBand = false;
			parts.push(`#${color}`);
			let runLength = 0;
			let runBits = 0;
			const flushRun = () => {
				if (runLength > 0) {
					parts.push(
						runLength > 3
							? `!${runLength}${String.fromCharCode(SIXEL_COLOR_CHAR_OFFSET + runBits)}`
							: String.fromCharCode(SIXEL_COLOR_CHAR_OFFSET + runBits).repeat(runLength),
					);
					runLength = 0;
				}
			};
			for (let x = 0; x < width; x++) {
				let bits = 0;
				for (let row = 0; row < bandRows; row++) {
					if (indices[(bandStart + row) * width + x] === color) bits |= 1 << row;
				}
				if (bits === runBits && runLength > 0) {
					runLength++;
				} else {
					flushRun();
					runBits = bits;
					runLength = 1;
				}
			}
			flushRun();
		}
	}

	parts.push("\x1b\\");
	return parts.join("");
}

/**
 * Convenience pipeline: PNG base64 -> Sixel sequence scaled to exactly
 * `targetWidthPx` x `targetHeightPx`. Returns `null` when the input cannot
 * be decoded as a supported PNG.
 */
export function encodeSixelFromPngBase64(
	base64Data: string,
	targetWidthPx: number,
	targetHeightPx: number,
): string | null {
	try {
		const image = decodePngToRgba(Buffer.from(base64Data, "base64"));
		if (!image) return null;
		const width = Math.max(1, Math.min(4096, Math.floor(targetWidthPx)));
		const height = Math.max(1, Math.min(4096, Math.floor(targetHeightPx)));
		const resized = resizeRgba(image, width, height);
		const { palette, indices } = quantizeRgba(resized);
		return encodeSixel(indices, width, height, palette);
	} catch {
		return null;
	}
}
