import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	dshFileReferenceFromCompletion,
	expandSelectedDshFileReferences,
	extractDshFileReferences,
} from "../src/metapi/dsh-file-references.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "metapi-dsh-references-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("DSH selected file references", () => {
	it("parses quoted tokens without treating email text as a reference", () => {
		expect(extractDshFileReferences('open @src/app.ts and @"notes/with space.md" but not me@example.com')).toEqual([
			"src/app.ts",
			"notes/with space.md",
		]);
		expect(dshFileReferenceFromCompletion("@src/a", "@src/app.ts")).toBe("src/app.ts");
		expect(dshFileReferenceFromCompletion("src/a", "src/app.ts")).toBeUndefined();
	});

	it("attaches only completion-selected text files and directories", async () => {
		const cwd = await temporaryDirectory();
		await writeFile(join(cwd, "selected.txt"), "selected body", "utf8");
		await writeFile(join(cwd, "typed.txt"), "must stay detached", "utf8");
		await mkdir(join(cwd, "folder"));
		await writeFile(join(cwd, "folder", "z.txt"), "z", "utf8");
		await mkdir(join(cwd, "folder", "a-dir"));

		const expansion = await expandSelectedDshFileReferences({
			text: "review @selected.txt @typed.txt @folder/",
			cwd,
			selected: new Set(["selected.txt", "folder/"]),
		});

		expect(expansion.attached).toEqual(["selected.txt", "folder/"]);
		expect(expansion.text).toContain("review @selected.txt @typed.txt @folder/");
		expect(expansion.text).toContain('<attached-file path="selected.txt">\nselected body\n</attached-file>');
		expect(expansion.text).not.toContain("must stay detached");
		expect(expansion.text).toContain('<attached-directory path="folder/">\na-dir/\nz.txt\n</attached-directory>');
		expect(expansion.images).toEqual([]);
	});

	it("adds supported images after existing draft images", async () => {
		const cwd = await temporaryDirectory();
		await writeFile(
			join(cwd, "pixel.png"),
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64",
			),
		);
		const existing = {
			type: "image" as const,
			data: "existing",
			mimeType: "image/jpeg" as const,
		};

		const expansion = await expandSelectedDshFileReferences({
			text: "compare @pixel.png",
			cwd,
			selected: new Set(["pixel.png"]),
			existingImages: [existing],
		});

		expect(expansion.attached).toEqual(["pixel.png"]);
		expect(expansion.text).toContain('<attached-image path="pixel.png" />');
		expect(expansion.images[0]).toBe(existing);
		expect(expansion.images[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
		expect(expansion.images[1]?.data).toEqual(expect.any(String));
	});

	it("fails explicitly for a selected path that cannot be read", async () => {
		const cwd = await temporaryDirectory();
		await expect(
			expandSelectedDshFileReferences({
				text: "review @missing.txt",
				cwd,
				selected: new Set(["missing.txt"]),
			}),
		).rejects.toThrow("无法读取 @ 文件引用：missing.txt");
	});
});
