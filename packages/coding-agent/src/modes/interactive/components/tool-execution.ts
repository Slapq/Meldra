import { Box, type Component, Container, getCapabilities, Image, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { ToolDefinition, ToolRenderContext } from "../../../core/extensions/types.ts";
import { isProfileToolPresentation, type ProfileToolPresentation } from "../../../core/profile-agent-runtime.ts";
import { createAllToolDefinitions, type ToolName } from "../../../core/tools/index.ts";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { convertToPng } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";

const FALLBACK_PREVIEW_LINES = 10;

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
}

export class ToolExecutionComponent extends Container {
	private contentBox: Box;
	private contentText: Text;
	private selfRenderContainer: Container;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolDefinition<any, any>;
	private builtInToolDefinition?: ToolDefinition<any, any>;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{
			type: string;
			text?: string;
			data?: string;
			mimeType?: string;
		}>;
		isError: boolean;
		details?: any;
	};
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	private hideComponent = false;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolDefinition<any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.builtInToolDefinition = createAllToolDefinitions(cwd)[toolName as ToolName];
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		// Always create all shell variants. contentBox is used for default renderer-based composition.
		// selfRenderContainer is used when the tool renders its own framing.
		// contentText is reserved for generic fallback rendering when no tool definition exists.
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.selfRenderContainer = new Container();

		if (this.hasRendererDefinition()) {
			this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
		} else {
			this.addChild(this.contentText);
		}

		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderCall;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderCall;
		}
		return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderResult;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderResult;
		}
		return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderShell ?? "default";
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderShell ?? "default";
		}
		return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
		};
	}

	private createCallFallback(): Component {
		return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}

		const lines = output.split("\n");
		const displayLines = this.expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
		const remaining = lines.length - displayLines.length;
		let text = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
		return new Text(text, 0, 0);
	}

	updateArgs(args: any): void {
		this.args = args;
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{
				type: string;
				text?: string;
				data?: string;
				mimeType?: string;
			}>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.updateDisplay();
		this.maybeConvertImagesForKitty();
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((c) => c.type === "image");
		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}

		if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			const lines: string[] = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
			return lines;
		}

		return super.render(width);
	}

	private updateDisplay(): void {
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		let hasContent = false;
		this.hideComponent = false;
		if (this.hasRendererDefinition()) {
			const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
			}
			renderContainer.clear();

			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				renderContainer.addChild(this.createCallFallback());
				hasContent = true;
			} else {
				try {
					const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
					this.callRendererComponent = component;
					renderContainer.addChild(component);
					hasContent = true;
				} catch {
					this.callRendererComponent = undefined;
					renderContainer.addChild(this.createCallFallback());
					hasContent = true;
				}
			}

			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					const component = this.createResultFallback();
					if (component) {
						renderContainer.addChild(component);
						hasContent = true;
					}
				} else {
					try {
						const component = resultRenderer(
							{
								content: this.result.content as any,
								details: this.result.details,
							},
							{ expanded: this.expanded, isPartial: this.isPartial },
							theme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = component;
						renderContainer.addChild(component);
						hasContent = true;
					} catch {
						this.resultRendererComponent = undefined;
						const component = this.createResultFallback();
						if (component) {
							renderContainer.addChild(component);
							hasContent = true;
						}
					}
				}
			}
		} else {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setText(this.formatToolExecution());
			hasContent = true;
		}

		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content.filter((c) => c.type === "image");
			const caps = getCapabilities();
			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (caps.images && this.showImages && img.data && img.mimeType) {
					const converted = this.convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;
					if (caps.images === "kitty" && imageMimeType !== "image/png") continue;

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: this.imageWidthCells },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	private formatFallbackSection(value: string, label: string, fromEnd: boolean): string {
		if (this.expanded) return value;
		const lines = value.split("\n");
		const limit = 5;
		if (lines.length <= limit) return value;
		const visible = fromEnd ? lines.slice(-limit) : lines.slice(0, limit);
		const hidden = lines.length - visible.length;
		const hint = `${theme.fg("muted", `... (${hidden} ${label} lines,`)} ${keyHint(
			"app.tools.expand",
			"to expand",
		)}${theme.fg("muted", ")")}`;
		return fromEnd ? `${hint}\n${visible.join("\n")}` : `${visible.join("\n")}\n${hint}`;
	}

	private getProfilePresentation(): ProfileToolPresentation | undefined {
		const details = this.result?.details;
		if (!details || typeof details !== "object") return undefined;
		const presentation = details.profilePresentation;
		return isProfileToolPresentation(presentation) ? presentation : undefined;
	}

	private formatProfilePresentation(presentation: ProfileToolPresentation): string {
		const titleIcon =
			{
				terminal: "💻",
				diff: "📋",
				read: "📄",
				search: "🔍",
				"web-search": "🌐",
				"web-fetch": "🔗",
			}[presentation.kind] ?? "";
		let text = theme.fg("toolTitle", theme.bold(`${titleIcon} ${presentation.title ?? this.toolName}`));
		let lines: string[] = [];
		if (presentation.kind === "terminal") {
			if (presentation.description) text += `\n${theme.fg("muted", presentation.description)}`;
			if (presentation.cwd) text += `\n${theme.fg("dim", `📂 ${presentation.cwd}`)}`;
			const output = presentation.output ?? this.getTextOutput();
			if (output) lines = output.split("\n");
			if (presentation.exitCode !== undefined && presentation.exitCode !== 0)
				lines.push(theme.fg("error", `❌ Exit code ${presentation.exitCode}`));
			if (presentation.signal) lines.push(theme.fg("error", `❌ Signal ${presentation.signal}`));
		} else if (presentation.kind === "diff") {
			for (const file of presentation.files) {
				lines.push(theme.fg("accent", `┌─ ${file.path}`));
				if (file.oldText !== null)
					lines.push(...file.oldText.split("\n").map((line) => theme.fg("error", `│ - ${line}`)));
				lines.push(...file.newText.split("\n").map((line) => theme.fg("success", `│ + ${line}`)));
				lines.push(theme.fg("accent", "└─"));
			}
		} else if (presentation.kind === "read") {
			text += `\n${theme.fg("muted", `${presentation.path}`)} ${theme.fg("dim", `· ${presentation.totalLines} lines`)}`;
			lines = presentation.lines.map(
				(line) => `${theme.fg("dim", `${line.number.toString().padStart(4)}:`)} ${line.text}`,
			);
		} else if (presentation.kind === "search") {
			lines = presentation.entries.map((entry) =>
				entry.lineNumber === undefined
					? theme.fg("accent", entry.path)
					: `${theme.fg("muted", entry.path)}:${theme.fg("accent", entry.lineNumber.toString())}: ${entry.text ?? ""}`,
			);
			if (presentation.truncated) lines.push(theme.fg("dim", `… ${presentation.total} total`));
		} else if (presentation.kind === "web-search") {
			if (presentation.answer) lines.push(theme.fg("text", presentation.answer));
			if (presentation.answer && presentation.sources.length) lines.push("");
			for (const source of presentation.sources) {
				lines.push(theme.fg("accent", source.title ?? source.url));
				const meta = [
					source.title ? theme.fg("dim", source.url) : undefined,
					source.publishedAt ? theme.fg("dim", source.publishedAt) : undefined,
				]
					.filter(Boolean)
					.join(" · ");
				if (meta) lines.push(meta);
				if (source.snippet) lines.push(theme.fg("muted", source.snippet));
				if (source !== presentation.sources[presentation.sources.length - 1]) lines.push("");
			}
			if (presentation.truncated) lines.push(theme.fg("dim", "… results truncated"));
		} else if (presentation.kind === "web-fetch") {
			const statusColor =
				presentation.statusCode >= 400 ? "error" : presentation.statusCode >= 300 ? "warning" : "success";
			lines.push(
				`${theme.fg("muted", presentation.url)} ${theme.fg(statusColor, `HTTP ${presentation.statusCode}`)}${presentation.truncated ? theme.fg("dim", " · truncated") : ""}`,
			);
		}
		if (lines.length > 0) text += `\n${this.formatFallbackSection(lines.join("\n"), "detail", false)}`;
		return text;
	}

	private formatToolExecution(): string {
		const presentation = this.getProfilePresentation();
		let text = presentation
			? this.formatProfilePresentation(presentation)
			: theme.fg("toolTitle", theme.bold(this.toolName));
		if (!presentation) {
			const content = JSON.stringify(this.args, null, 2);
			if (content) {
				text += `\n\n${this.formatFallbackSection(content, "argument", false)}`;
			}
			const output = this.getTextOutput();
			if (output) {
				text += `\n${this.formatFallbackSection(output, "output", true)}`;
			}
		}
		const durationMs =
			this.result?.details &&
			typeof this.result.details === "object" &&
			typeof this.result.details.durationMs === "number" &&
			Number.isFinite(this.result.details.durationMs) &&
			this.result.details.durationMs >= 0
				? this.result.details.durationMs
				: undefined;
		if (durationMs !== undefined) {
			text += `\n${theme.fg("muted", `Completed ${(durationMs / 1000).toFixed(1)}s`)}`;
		}
		return text;
	}
}
