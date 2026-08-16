import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import { resolveReadPath } from "../core/tools/path-utils.ts";
import { processImage } from "../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";

const MAX_FILE_CHARS = 50_000;
const MAX_TOTAL_CHARS = 200_000;
const MAX_DIRECTORY_ENTRIES = 200;

export interface DshFileReferenceExpansion {
	text: string;
	images: ImageContent[];
	attached: string[];
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Extract unique whitespace-delimited @path and @"path with spaces" tokens. */
export function extractDshFileReferences(text: string): string[] {
	const references: string[] = [];
	const seen = new Set<string>();
	let index = 0;
	while (index < text.length) {
		const at = text.indexOf("@", index);
		if (at < 0) break;
		index = at + 1;
		if (at > 0 && !/\s/.test(text[at - 1] ?? "")) continue;
		let path: string;
		if (text[at + 1] === '"') {
			const close = text.indexOf('"', at + 2);
			if (close < 0) continue;
			path = text.slice(at + 2, close);
			index = close + 1;
		} else {
			let end = at + 1;
			while (end < text.length && !/\s/.test(text[end] ?? "")) end++;
			path = text.slice(at + 1, end);
			index = end;
		}
		if (path && !path.startsWith("@") && !seen.has(path)) {
			seen.add(path);
			references.push(path);
		}
	}
	return references;
}

export function dshFileReferenceFromCompletion(prefix: string, value: string): string | undefined {
	if (!prefix.startsWith("@") || !value.startsWith("@")) return undefined;
	const parsed = extractDshFileReferences(value);
	return parsed.length === 1 ? parsed[0] : undefined;
}

function decodeText(bytes: Uint8Array, path: string): string {
	if (bytes.includes(0)) throw new Error(`文件不是可附加的 UTF-8 文本：${path}`);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`文件不是可附加的 UTF-8 文本：${path}`);
	}
}

function compareNames(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export async function expandSelectedDshFileReferences(options: {
	text: string;
	cwd: string;
	selected: ReadonlySet<string>;
	existingImages?: ImageContent[];
}): Promise<DshFileReferenceExpansion> {
	const references = extractDshFileReferences(options.text).filter((path) => options.selected.has(path));
	if (references.length === 0)
		return {
			text: options.text,
			images: options.existingImages ?? [],
			attached: [],
		};

	let remaining = MAX_TOTAL_CHARS;
	const blocks: string[] = [options.text];
	const images = [...(options.existingImages ?? [])];
	const attached: string[] = [];
	for (const path of references) {
		const absolutePath = resolveReadPath(path, options.cwd);
		let info: Stats;
		try {
			info = await stat(absolutePath);
		} catch {
			throw new Error(`无法读取 @ 文件引用：${path}`);
		}
		const escapedPath = escapeAttribute(path);
		if (info.isDirectory()) {
			let entries: Dirent[];
			try {
				entries = await readdir(absolutePath, { withFileTypes: true });
			} catch {
				throw new Error(`无法读取 @ 目录引用：${path}`);
			}
			entries.sort((left, right) => compareNames(left.name, right.name));
			const visible = entries.slice(0, MAX_DIRECTORY_ENTRIES);
			const lines = visible.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
			if (entries.length > visible.length) lines.push(`... (${entries.length - visible.length} more)`);
			const body = lines.join("\n");
			if (body.length > remaining) throw new Error(`@ 文件引用总内容超过 ${MAX_TOTAL_CHARS} 字符：${path}`);
			remaining -= body.length;
			blocks.push(`<attached-directory path="${escapedPath}">\n${body}\n</attached-directory>`);
			attached.push(path);
			continue;
		}
		if (!info.isFile()) throw new Error(`@ 引用不是普通文件或目录：${path}`);

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		if (mimeType) {
			const processed = await processImage(await readFile(absolutePath), mimeType, {
				autoResizeImages: true,
			});
			if (!processed.ok) throw new Error(`无法附加图片 ${path}：${processed.message}`);
			images.push({
				type: "image",
				data: processed.data,
				mimeType: processed.mimeType,
			});
			blocks.push(`<attached-image path="${escapedPath}" />`);
			attached.push(path);
			continue;
		}

		let content = decodeText(await readFile(absolutePath), path);
		if (remaining <= 0) throw new Error(`@ 文件引用总内容超过 ${MAX_TOTAL_CHARS} 字符：${path}`);
		const cap = Math.min(MAX_FILE_CHARS, remaining);
		const truncated = content.length > cap;
		if (truncated) content = content.slice(0, cap);
		remaining -= content.length;
		blocks.push(
			`<attached-file path="${escapedPath}">\n${content}${truncated ? "\n[... truncated]" : ""}\n</attached-file>`,
		);
		attached.push(path);
	}
	return { text: blocks.join("\n\n"), images, attached };
}
