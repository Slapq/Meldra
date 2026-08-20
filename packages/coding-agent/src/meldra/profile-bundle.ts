import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { DefaultPackageManager } from "../core/package-manager.ts";
import { type ProfileEnvironmentDescriptor, resolveProfileRuntimeProvider } from "../core/profile-agent-runtime.ts";
import { type PackageSource, type Settings, SettingsManager } from "../core/settings-manager.ts";
import { spawnProcess, waitForChildProcess } from "../utils/child-process.ts";
import { isLocalPath } from "../utils/paths.ts";
import { comparePackageVersions } from "../utils/version-check.ts";
import { builtInProfileRuntimeProviders } from "./profile-runtime-providers.ts";
import {
	assertProfileName,
	DEFAULT_PROFILE_NAME,
	getProfileAgentDir,
	MELDRA_PROFILES_DIR,
	PI_COMPATIBILITY_PROFILE_NAME,
} from "./profile-service.ts";

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 10_000;
const PROFILE_EXPORT_AUDIT_FILE = "MELDRA_PROFILE_EXPORT_AUDIT.md";
const PROFILE_EXPORT_SCAN_LIMIT_BYTES = 1024 * 1024;

export const PROFILE_EXPORT_INCLUDED_CATEGORIES = [
	"Profile Bundle source files",
	"effective portable Profile settings",
	"Pi package and resource declarations",
	"Profile Runtime provider and portable package declarations",
] as const;

export const PROFILE_EXPORT_EXCLUDED_CATEGORIES = [
	"managed credentials and authentication stores",
	"Sessions and external Runtime ledgers",
	"Profile-local Runtime Settings, caches, and Loader state",
	"project .pi configuration and one-run CLI overrides",
	"directory bindings and other machine-local Profile state",
] as const;

export type ProfileExportCredentialKind = "credential-field" | "credential-prefix" | "credential-url";

export interface ProfileExportFinding {
	path: string;
	line: number;
	kind: ProfileExportCredentialKind;
}

export interface ProfileExportAudit {
	reportPath: string;
	includedFiles: string[];
	excludedCategories: readonly string[];
	findings: ProfileExportFinding[];
}

export interface ProfileExportResult {
	output: string;
	audit: ProfileExportAudit;
}

async function runProfileUpdateCheck(command: string, args: string[]): Promise<string> {
	const child = spawnProcess(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	let stdout = "";
	let timedOut = false;
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.resume();
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, UPDATE_CHECK_TIMEOUT_MS);
	timeout.unref();
	try {
		const code = await waitForChildProcess(child);
		if (timedOut) throw new Error(`Profile update check timed out after ${UPDATE_CHECK_TIMEOUT_MS}ms.`);
		if (code !== 0) throw new Error(`Profile update check exited with code ${code ?? "unknown"}.`);
		return stdout;
	} finally {
		clearTimeout(timeout);
	}
}
export interface ProfileEnvironmentDeclaration {
	required?: string[];
	optional?: string[];
	inherit?: string[];
	defaults?: Record<string, string>;
}

function validateEnvironmentNameList(value: unknown, field: string): void {
	if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || name.trim().length === 0)) {
		throw new Error(`Profile environment.${field} must be an array of non-empty strings.`);
	}
}

export function normalizeProfileEnvironmentDeclaration(value: unknown): ProfileEnvironmentDeclaration | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Profile environment must be an object.");
	}
	const declaration = value as Record<string, unknown>;
	for (const field of ["required", "optional", "inherit"] as const) {
		if (declaration[field] !== undefined) validateEnvironmentNameList(declaration[field], field);
	}
	if (declaration.defaults !== undefined) {
		if (!declaration.defaults || typeof declaration.defaults !== "object" || Array.isArray(declaration.defaults)) {
			throw new Error("Profile environment.defaults must be an object of strings.");
		}
		for (const [name, defaultValue] of Object.entries(declaration.defaults)) {
			if (!name.trim() || typeof defaultValue !== "string") {
				throw new Error("Profile environment.defaults must have non-empty names and string values.");
			}
		}
	}
	return value as ProfileEnvironmentDeclaration;
}

export interface PortableProfileRuntimeDeclaration {
	/** Registered Profile Runtime Provider identity. */
	provider: string;
	/** Opaque portable configuration interpreted only by that provider. */
	config?: unknown;
}

export interface PortableProfileManifest {
	profileVersion: number;
	displayName?: string;
	settings?: Settings;
	packages?: PackageSource[];
	environment?: ProfileEnvironmentDeclaration;
	runtime?: PortableProfileRuntimeDeclaration;
}

export interface InstalledProfileRecord {
	schemaVersion: 1;
	id: string;
	displayName: string;
	source: string;
	primaryPackageSource: PackageSource;
	installedPackagePath: string;
	packageName: string;
	packageVersion?: string;
	importedAt: string;
	updatedAt?: string;
	portable: PortableProfileManifest;
}

interface ProfilePackageJson {
	name?: string;
	version?: string;
	keywords?: string[];
	pi?: Record<string, unknown>;
	metapi?: Partial<PortableProfileManifest>;
	meldra?: Partial<PortableProfileManifest>;
}

export interface ImportProfileOptions {
	cwd: string;
	id?: string;
	name?: string;
	replace?: boolean;
}

export class ProfileConflictError extends Error {
	readonly profileId: string;

	constructor(profileId: string) {
		super(`Profile "${profileId}" already exists.`);
		this.name = "ProfileConflictError";
		this.profileId = profileId;
	}
}

function profileRoot(id: string): string {
	return join(MELDRA_PROFILES_DIR, assertProfileName(id));
}

export function getProfileRecordPath(id: string): string {
	return join(profileRoot(id), "profile.json");
}

export function readProfileRecord(id: string): InstalledProfileRecord | undefined {
	const path = getProfileRecordPath(id);
	if (!existsSync(path)) return undefined;
	try {
		const record = JSON.parse(readFileSync(path, "utf8")) as InstalledProfileRecord;
		return record?.schemaVersion === 1 && record.id === id ? record : undefined;
	} catch {
		return undefined;
	}
}

export async function checkProfileUpdate(id: string): Promise<string | undefined> {
	const record = readProfileRecord(id);
	if (!record || !record.source.startsWith("npm:") || !record.packageVersion) return undefined;
	const cachePath = join(profileRoot(id), "update-check.json");
	let cached: { checkedAt?: string; availableVersion?: string } = {};
	try {
		cached = JSON.parse(readFileSync(cachePath, "utf8")) as typeof cached;
	} catch {
		// A missing or malformed cache simply triggers a fresh check.
	}
	if (cached.checkedAt && Date.now() - Date.parse(cached.checkedAt) < UPDATE_CHECK_INTERVAL_MS) {
		return cached.availableVersion;
	}
	try {
		const stdout = await runProfileUpdateCheck("npm", ["view", record.packageName, "version", "--json"]);
		const availableVersion = String(JSON.parse(stdout));
		const nextCache = {
			checkedAt: new Date().toISOString(),
			...(comparePackageVersions(availableVersion, record.packageVersion) === 1 ? { availableVersion } : {}),
		};
		writeFileSync(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`, "utf8");
		return nextCache.availableVersion;
	} catch {
		return undefined;
	}
}

function writeProfileRecord(record: InstalledProfileRecord): void {
	mkdirSync(profileRoot(record.id), { recursive: true });
	writeFileSync(getProfileRecordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function slugifyProfileId(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/^@/, "")
		.replace(/[\\/]+/g, "-")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
	return slug || "imported-profile";
}

function sourceName(source: string): string {
	const withoutPrefix = source.replace(/^(npm:|git:)/, "");
	const withoutRef = withoutPrefix.replace(/@[^/@]+$/, "");
	return basename(withoutRef.replace(/\\/g, "/")).replace(/\.git$/, "") || "imported-profile";
}

function readPackageJson(packageRoot: string): ProfilePackageJson {
	const path = join(packageRoot, "package.json");
	if (!existsSync(path)) throw new Error(`Profile Bundle has no package.json: ${packageRoot}`);
	const value = JSON.parse(readFileSync(path, "utf8")) as ProfilePackageJson;
	if (!value.name) throw new Error(`Profile Bundle package.json has no name: ${path}`);
	if ((!value.meldra || value.meldra.profileVersion !== 1) && (!value.metapi || value.metapi.profileVersion !== 1)) {
		throw new Error(`Profile Bundle requires meldra.profileVersion = 1 (legacy metapi is also accepted): ${path}`);
	}
	return value;
}

function portableManifest(packageJson: ProfilePackageJson): Partial<PortableProfileManifest> {
	return packageJson.meldra ?? packageJson.metapi ?? {};
}

function normalizeRuntimeDeclaration(value: unknown): PortableProfileRuntimeDeclaration | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const declaration = value as { provider?: unknown; config?: unknown };
	if (typeof declaration.provider !== "string" || !declaration.provider.trim()) return undefined;
	return {
		provider: declaration.provider.trim(),
		...(Object.hasOwn(declaration, "config") ? { config: declaration.config } : {}),
	};
}

export function normalizePortableProfileManifest(value: Partial<PortableProfileManifest>): PortableProfileManifest {
	const runtime = normalizeRuntimeDeclaration(value.runtime);
	const environment = normalizeProfileEnvironmentDeclaration(value.environment);
	return {
		profileVersion: 1,
		...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
		...(value.settings && typeof value.settings === "object" ? { settings: value.settings } : {}),
		...(Array.isArray(value.packages) ? { packages: value.packages } : {}),
		...(environment ? { environment } : {}),
		...(runtime ? { runtime } : {}),
	};
}

function runtimeEnvironment(record: InstalledProfileRecord, cwd: string): ProfileEnvironmentDescriptor {
	return {
		name: record.id,
		displayName: record.displayName,
		agentDir: getProfileAgentDir(record.id),
		cwd,
		compatibility: false,
		...(record.portable.runtime ? { runtime: record.portable.runtime } : {}),
	};
}

async function restoreProfileRuntimePackages(record: InstalledProfileRecord, cwd: string): Promise<void> {
	const environment = runtimeEnvironment(record, cwd);
	const provider = resolveProfileRuntimeProvider(builtInProfileRuntimeProviders, environment);
	if (!provider?.packages?.restore) return;
	const result = await provider.packages.restore(environment, record.portable.runtime?.config);
	if (result.code !== 0) {
		throw new Error(`Profile Runtime package restoration failed with code ${result.code}.`);
	}
	if (result.verificationRequired && provider.packages.verify) {
		await provider.packages.verify(environment);
	}
}

async function runtimeDeclarationForExport(
	record: InstalledProfileRecord,
	cwd: string,
): Promise<PortableProfileRuntimeDeclaration | undefined> {
	const environment = runtimeEnvironment(record, cwd);
	const provider = resolveProfileRuntimeProvider(builtInProfileRuntimeProviders, environment);
	if (!provider?.packages?.snapshot) return record.portable.runtime;
	const config = await provider.packages.snapshot(environment, record.portable.runtime?.config);
	return {
		provider: record.portable.runtime?.provider ?? provider.id,
		...(config !== undefined ? { config } : {}),
	};
}

function copyLocalBundle(source: string, cwd: string, targetRoot: string): string {
	const sourcePath = resolve(cwd, source);
	if (!existsSync(sourcePath)) throw new Error(`Profile source does not exist: ${sourcePath}`);
	const target = join(targetRoot, "bundle");
	rmSync(target, { recursive: true, force: true });
	cpSync(sourcePath, target, { recursive: true, force: true });
	return target;
}

async function installProfilePackages(
	cwd: string,
	agentDir: string,
	primarySource: string,
	additional: PackageSource[] = [],
): Promise<{
	packageManager: DefaultPackageManager;
	installedPath: string;
	primaryPackageSource: PackageSource;
}> {
	const settingsManager = SettingsManager.create(cwd, agentDir, {
		projectTrusted: false,
	});
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
	});
	await packageManager.installAndPersist(primarySource);
	for (const entry of additional) {
		const source = typeof entry === "string" ? entry : entry.source;
		await packageManager.installAndPersist(source);
	}
	await settingsManager.flush();
	const installedPath = packageManager.getInstalledPath(primarySource, "user");
	if (!installedPath) throw new Error(`Could not resolve installed Profile package: ${primarySource}`);
	const primaryPackageSource = settingsManager.getPackages()[0];
	if (!primaryPackageSource) throw new Error(`Profile package was not persisted: ${primarySource}`);
	return { packageManager, installedPath, primaryPackageSource };
}

export async function importProfile(source: string, options: ImportProfileOptions): Promise<InstalledProfileRecord> {
	const requestedName = options.name?.trim();
	const id = assertProfileName(options.id ?? slugifyProfileId(requestedName || sourceName(source)));
	if (id === DEFAULT_PROFILE_NAME || id === PI_COMPATIBILITY_PROFILE_NAME) {
		throw new Error(`Profile name "${id}" is reserved.`);
	}
	const root = profileRoot(id);
	const rootExisted = existsSync(root);
	if (rootExisted && !options.replace) throw new ProfileConflictError(id);
	try {
		mkdirSync(root, { recursive: true });
		const agentDir = getProfileAgentDir(id);
		mkdirSync(agentDir, { recursive: true });

		let installSource = source;
		if (isLocalPath(source)) installSource = copyLocalBundle(source, options.cwd, root);

		const firstInstall = await installProfilePackages(options.cwd, agentDir, installSource);
		const packageJson = readPackageJson(firstInstall.installedPath);
		const portable = normalizePortableProfileManifest(portableManifest(packageJson));
		if (portable.packages?.length) {
			await installProfilePackages(options.cwd, agentDir, installSource, portable.packages);
		}
		const now = new Date().toISOString();
		const record: InstalledProfileRecord = {
			schemaVersion: 1,
			id,
			displayName: requestedName || portable.displayName || packageJson.name || id,
			source,
			primaryPackageSource: firstInstall.primaryPackageSource,
			installedPackagePath: firstInstall.installedPath,
			packageName: packageJson.name || id,
			...(packageJson.version ? { packageVersion: packageJson.version } : {}),
			importedAt: readProfileRecord(id)?.importedAt ?? now,
			...(options.replace ? { updatedAt: now } : {}),
			portable,
		};
		await restoreProfileRuntimePackages(record, options.cwd);
		writeProfileRecord(record);
		return record;
	} catch (error) {
		if (!rootExisted) rmSync(root, { recursive: true, force: true });
		throw error;
	}
}

function listExportedFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) visit(absolute);
			else files.push(relative(root, absolute).split(sep).join("/"));
		}
	};
	visit(root);
	return files.sort();
}

function isScannableExportFile(path: string): boolean {
	const extension = extname(path).toLowerCase();
	return (
		!extension ||
		[
			".bat",
			".cjs",
			".cmd",
			".env",
			".ini",
			".js",
			".json",
			".jsonc",
			".md",
			".mjs",
			".ps1",
			".sh",
			".toml",
			".ts",
			".txt",
			".yaml",
			".yml",
		].includes(extension)
	);
}

function likelyPlaceholder(value: string): boolean {
	const normalized = value.trim().replace(/^['"]|['"]$/g, "");
	return (
		normalized.length < 8 ||
		/^(?:\$|%|<|\*+|process\.env\.|MELDRA_MODEL_|METAPI_MODEL_)/i.test(normalized) ||
		/(?:example|placeholder|redacted|replace[-_ ]?me|your[-_ ]?(?:key|token|secret)|change[-_ ]?me)/i.test(normalized)
	);
}

function scanExportedFile(root: string, path: string): ProfileExportFinding[] {
	if (path === PROFILE_EXPORT_AUDIT_FILE || !isScannableExportFile(path)) return [];
	const absolute = join(root, ...path.split("/"));
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.size > PROFILE_EXPORT_SCAN_LIMIT_BYTES) return [];
	const buffer = readFileSync(absolute);
	if (buffer.includes(0)) return [];
	const findings: ProfileExportFinding[] = [];
	const seen = new Set<string>();
	const add = (line: number, kind: ProfileExportCredentialKind): void => {
		const key = `${line}:${kind}`;
		if (seen.has(key)) return;
		seen.add(key);
		findings.push({ path, line, kind });
	};
	for (const [index, line] of buffer.toString("utf8").split(/\r?\n/).entries()) {
		const fieldPattern =
			/["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)["']?\s*[:=]\s*([^\s,}]+)/gi;
		for (const match of line.matchAll(fieldPattern)) {
			if (!likelyPlaceholder(match[1] ?? "")) add(index + 1, "credential-field");
		}
		if (
			/(?:\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bAIza[A-Za-z0-9_-]{20,}|\bxox[baprs]-[A-Za-z0-9-]{16,})/.test(
				line,
			)
		) {
			add(index + 1, "credential-prefix");
		}
		if (/https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(line)) add(index + 1, "credential-url");
	}
	return findings;
}

function markdownCode(value: string): string {
	return `\`${value.replaceAll("`", "'")}\``;
}

export function writeProfileExportAudit(output: string): ProfileExportAudit {
	const filesBeforeReport = listExportedFiles(output).filter((path) => path !== PROFILE_EXPORT_AUDIT_FILE);
	const findings = filesBeforeReport.flatMap((path) => scanExportedFile(output, path));
	const includedFiles = [...filesBeforeReport, PROFILE_EXPORT_AUDIT_FILE].sort();
	const reportPath = join(output, PROFILE_EXPORT_AUDIT_FILE);
	const findingLines = findings.length
		? findings.map((finding) => `- ${markdownCode(finding.path)}:${finding.line} — ${finding.kind}`)
		: ["- No credential-like literals were detected by the advisory scan."];
	const report = [
		"# Meldra Profile Export Audit / 导出审计",
		"",
		"> This report is advisory. Source files are exported as-is; review the Bundle before sharing.",
		"> 本报告仅用于提示。源文件会按原样导出；分享前请自行检查 Bundle。",
		"",
		"## Included categories / 已包含类别",
		"",
		...PROFILE_EXPORT_INCLUDED_CATEGORIES.map((category) => `- ${category}`),
		"",
		"## Excluded managed state / 未自动导出的托管状态",
		"",
		...PROFILE_EXPORT_EXCLUDED_CATEGORIES.map((category) => `- ${category}`),
		"",
		"> Files already hardcoded into the Profile Bundle are still included. Move credentials to the Meldra credential service or environment variables, then export again.",
		"> 已硬编码到 Profile Bundle 源文件中的内容仍会被导出。请将凭据迁移到 Meldra credential service 或环境变量后重新导出。",
		"",
		"## Advisory findings / 脱敏提示",
		"",
		...findingLines,
		"",
		"The report contains paths, line numbers, and finding types only. Matched values are never written here.",
		"本报告只记录路径、行号和类型，不写入匹配到的值。",
		"",
		"## Exported files / 导出文件",
		"",
		...includedFiles.map((path) => `- ${markdownCode(path)}`),
		"",
	].join("\n");
	writeFileSync(reportPath, report, "utf8");
	return {
		reportPath,
		includedFiles,
		excludedCategories: PROFILE_EXPORT_EXCLUDED_CATEGORIES,
		findings,
	};
}

export async function exportProfileWithAudit(
	id: string,
	outputDirectory: string,
	cwd: string,
): Promise<ProfileExportResult> {
	const record = readProfileRecord(id);
	if (!record) throw new Error(`Profile "${id}" is not an imported Profile.`);
	const output = resolve(cwd, outputDirectory);
	rmSync(output, { recursive: true, force: true });
	cpSync(record.installedPackagePath, output, { recursive: true, force: true });
	const original = readPackageJson(output);
	const settingsManager = SettingsManager.create(cwd, getProfileAgentDir(id), {
		projectTrusted: false,
		baseSettings: record.portable.settings,
	});
	const packages = settingsManager.getPackages().filter((entry) => {
		const source = typeof entry === "string" ? entry : entry.source;
		const primary =
			typeof record.primaryPackageSource === "string"
				? record.primaryPackageSource
				: record.primaryPackageSource?.source;
		return source !== primary && source !== record.source && source !== record.installedPackagePath;
	});
	const effectiveSettings = settingsManager.getEffectiveGlobalSettings();
	delete effectiveSettings.packages;
	delete effectiveSettings.theme;
	const runtime = await runtimeDeclarationForExport(record, cwd);
	const packageJson: ProfilePackageJson = {
		...original,
		name: slugifyProfileId(record.displayName),
		version: original.version ?? "0.1.0",
		keywords: [
			...new Set([
				...(original.keywords ?? []).filter(
					(keyword) => keyword !== "metapi-profile" && keyword !== "metapi-starter",
				),
				"pi-package",
				"meldra-profile",
			]),
		],
		meldra: {
			profileVersion: 1,
			displayName: record.displayName,
			settings: effectiveSettings,
			...(packages.length ? { packages } : {}),
			...(record.portable.environment ? { environment: record.portable.environment } : {}),
			...(runtime ? { runtime } : {}),
		},
	};
	writeFileSync(join(output, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
	return { output, audit: writeProfileExportAudit(output) };
}

export async function exportProfile(id: string, outputDirectory: string, cwd: string): Promise<string> {
	return (await exportProfileWithAudit(id, outputDirectory, cwd)).output;
}

export async function updateProfile(id: string, cwd: string): Promise<InstalledProfileRecord> {
	const record = readProfileRecord(id);
	if (!record) throw new Error(`Profile "${id}" is not an imported Profile.`);
	if (isLocalPath(record.source)) {
		return importProfile(record.source, {
			cwd,
			id,
			name: record.displayName,
			replace: true,
		});
	}
	const agentDir = getProfileAgentDir(id);
	const settingsManager = SettingsManager.create(cwd, agentDir, {
		projectTrusted: false,
		baseSettings: record.portable.settings,
	});
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
	});
	await packageManager.update(record.source);
	const installedPath = packageManager.getInstalledPath(record.source, "user") ?? record.installedPackagePath;
	const packageJson = readPackageJson(installedPath);
	const updated: InstalledProfileRecord = {
		...record,
		displayName: portableManifest(packageJson).displayName ?? record.displayName,
		installedPackagePath: installedPath,
		packageVersion: packageJson.version,
		portable: normalizePortableProfileManifest(portableManifest(packageJson)),
		updatedAt: new Date().toISOString(),
	};
	await restoreProfileRuntimePackages(updated, cwd);
	writeProfileRecord(updated);
	return updated;
}
