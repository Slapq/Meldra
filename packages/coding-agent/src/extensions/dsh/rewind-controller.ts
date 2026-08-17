import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { DshProfileRuntime } from "../../metapi/dsh-profile-runtime.ts";
import { UserMessageSelectorComponent } from "../../modes/interactive/components/user-message-selector.ts";

export interface DshRewindChoice {
	seq: number;
	boundary: number;
	text: string;
	attachments: Record<string, unknown>[];
}

const ATTACHMENT_TIMEOUT_MS = 10_000;
const RUNTIME_OPERATION_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
				timer.unref?.();
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function runDshRewind(options: {
	ctx: ExtensionCommandContext;
	runtime: DshProfileRuntime;
	choices: DshRewindChoice[];
	truncated: boolean;
	isRunning: () => boolean;
	clearQueue: () => void;
	invalidateCatalogs: () => void;
	refreshProjections: () => Promise<void>;
}): Promise<void> {
	const { ctx, runtime, choices, truncated } = options;
	const choice = await ctx.ui.custom<DshRewindChoice | undefined>((_tui, _theme, _keybindings, done) => {
		const byId = new Map(choices.map((item) => [String(item.seq), item]));
		return new UserMessageSelectorComponent(
			choices.map((item, index) => ({
				id: String(item.seq),
				text: item.text,
				metadata: `Turn ${choices.length - index} of ${choices.length}${item.attachments.length > 0 ? ` · ${item.attachments.length} image(s)` : ""}`,
			})),
			(id) => done(byId.get(id)),
			() => done(undefined),
			undefined,
			{
				title: `Rewind DSH Session${truncated ? " (history limit reached)" : ""}`,
				description: "Select a user turn to fork from its preceding completed boundary and restore its draft",
			},
		);
	});
	if (!choice) return;

	let forkedSessionId: string | undefined;
	try {
		const images: ImageContent[] = [];
		for (const reference of choice.attachments) {
			if (typeof reference.attachmentId !== "string") throw new Error("Harness 历史图片缺少 attachmentId。");
			const loaded = await withTimeout(
				runtime.attachment(reference.attachmentId),
				ATTACHMENT_TIMEOUT_MS,
				"读取 Harness 历史图片超时，请稍后重试。",
			);
			const attachment = isRecord(loaded.attachment) ? loaded.attachment : undefined;
			if (!attachment || typeof loaded.data !== "string" || typeof attachment.mediaType !== "string") {
				throw new Error("Harness 返回了无效 Image Attachment。");
			}
			images.push({
				type: "image",
				data: loaded.data,
				mimeType: attachment.mediaType as ImageContent["mimeType"],
			});
		}

		const sourceSessionId = runtime.sessionId;
		if (
			!(await ctx.ui.confirm(
				"回退并重写",
				`将从消息 #${choice.seq} 之前的已完成回合派生新 Session，源 Session ${sourceSessionId ?? "未知"} 保持不变${runtime.isStreaming ? "，当前运行将先取消" : ""}。是否继续?`,
			))
		) {
			return;
		}

		// DshProfileRuntime.abort() settles both Harness cancellation and its local active turn.
		// The extension-level running flag is only a presentation projection and is not used here.
		if (runtime.isStreaming || options.isRunning()) {
			await withTimeout(
				runtime.abort(),
				RUNTIME_OPERATION_TIMEOUT_MS,
				"Harness 回合取消超时，未执行 Rewind。请确认当前回合已结束后重试。",
			);
		}
		const sessionId = await withTimeout(
			runtime.fork(choice.boundary),
			RUNTIME_OPERATION_TIMEOUT_MS,
			"Harness Rewind 派生 Session 超时，源 Session 未被修改。请稍后重试。",
		);
		forkedSessionId = sessionId;
		options.clearQueue();
		options.invalidateCatalogs();
		await options.refreshProjections();
		if (!ctx.ui.setEditorDraft({ text: choice.text, images })) {
			throw new Error("当前 UI 无法保留多模态编辑器草稿。");
		}
		ctx.ui.notify(
			`已派生并切换到 DSH Session：${sessionId}。原消息${images.length > 0 ? `及 ${images.length} 张图片` : ""}已回填，可修改后发送。`,
			"info",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(
			forkedSessionId
				? `DSH Rewind 已派生 Session ${forkedSessionId}，但草稿或界面恢复失败：${message}`
				: `DSH Rewind 未完成：${message}`,
			"error",
		);
	}
}
