import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../config.ts";
import { type ProfileRuntimePackageRequest, resolveProfileRuntimeProvider } from "../core/profile-agent-runtime.ts";
import {
	exportProfileWithAudit,
	importProfile,
	ProfileConflictError,
	readProfileRecord,
	updateProfile,
} from "./profile-bundle.ts";
import { builtInProfileRuntimeProviders } from "./profile-runtime-providers.ts";
import {
	bindDirectory,
	formatProfileStatus,
	getProfileAgentDir,
	listDirectoryBindings,
	listInstalledProfiles,
	resolveProfile,
	unbindDirectory,
} from "./profile-service.ts";

function printUsage(): void {
	console.log(`${chalk.bold("Usage:")}
  metapi profile
  metapi profile list
  metapi profile status [name]
  metapi profile import <source> [--name <name>] [--replace] [--bind-current|--no-bind]
  metapi profile export <name> [directory]
  metapi profile update <name>
  metapi profile plugins <name> list
  metapi profile plugins <name> add <source>
  metapi profile plugins <name> remove <package>
  metapi profile plugins <name> update
  metapi profile bind [directory] <name>
  metapi profile unbind [directory]`);
}

function ask(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function parseImportOptions(args: string[]): {
	source?: string;
	name?: string;
	replace: boolean;
	bindCurrent?: boolean;
} {
	let source: string | undefined;
	let name: string | undefined;
	let replace = false;
	let bindCurrent: boolean | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--name") {
			name = args[++index];
			if (!name) throw new Error("--name requires a value");
		} else if (arg === "--replace") {
			replace = true;
		} else if (arg === "--bind-current" || arg === "--no-bind") {
			const nextValue = arg === "--bind-current";
			if (bindCurrent !== undefined && bindCurrent !== nextValue)
				throw new Error("Choose only one of --bind-current or --no-bind");
			bindCurrent = nextValue;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown Profile import option: ${arg}`);
		} else if (!source) {
			source = arg;
		} else {
			throw new Error(`Unexpected Profile import argument: ${arg}`);
		}
	}
	return { source, name, replace, bindCurrent };
}

async function offerBinding(
	record: Awaited<ReturnType<typeof importProfile>>,
	bindCurrent: boolean | undefined,
): Promise<void> {
	if (bindCurrent === true) {
		bindDirectory(process.cwd(), record.id);
		console.log(`Bound current directory to Profile ${record.id}.`);
		return;
	}
	if (bindCurrent === false) return;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Non-interactive Profile import requires --bind-current or --no-bind");
	}
	const answer = (await ask(`Bind current directory to ${record.displayName}? [y/N] `)).toLowerCase();
	if (answer === "y" || answer === "yes") {
		bindDirectory(process.cwd(), record.id);
		console.log(`Bound current directory to Profile ${record.id}.`);
	}
}

async function runProfilePlugins(args: string[]): Promise<void> {
	const [name, operation, argument, ...extra] = args;
	if (!name || !operation || extra.length > 0) {
		throw new Error("Usage: metapi profile plugins <name> list|add <source>|remove <package>|update");
	}
	let request: ProfileRuntimePackageRequest;
	if (operation === "list" && argument === undefined) request = { operation: "list" };
	else if (operation === "add" && argument) request = { operation: "add", source: argument };
	else if (operation === "remove" && argument) request = { operation: "remove", packageName: argument };
	else if (operation === "update" && argument === undefined) request = { operation: "update" };
	else throw new Error("Usage: metapi profile plugins <name> list|add <source>|remove <package>|update");

	const profile = resolveProfile(process.cwd(), name);
	const record = readProfileRecord(profile.name);
	const environment = {
		...profile,
		cwd: process.cwd(),
		...(record?.portable.runtime ? { runtime: record.portable.runtime } : {}),
	};
	const provider = resolveProfileRuntimeProvider(builtInProfileRuntimeProviders, environment);
	if (!provider) throw new Error(`Profile "${name}" uses the native Pi runtime and has no runtime packages.`);
	if (!provider.packages) throw new Error(`Profile Runtime Provider "${provider.id}" does not manage packages.`);
	const result = await provider.packages.execute(environment, request, {
		onOutput: (chunk) => process.stdout.write(chunk),
	});
	if (result.code !== 0) throw new Error(`Profile package command exited with code ${result.code}.`);
	if (!result.output) console.log("Profile package command completed.");
	if (result.verificationRequired && provider.packages.verify) {
		const verification = await provider.packages.verify(environment);
		console.log(`Profile Runtime Loader verified ${verification.activeEntries} active entries.`);
	}
}

async function runImport(args: string[]): Promise<void> {
	const options = parseImportOptions(args);
	if (!options.source)
		throw new Error("Usage: metapi profile import <source> [--name <name>] [--replace] [--bind-current|--no-bind]");
	if (options.bindCurrent === undefined && (!process.stdin.isTTY || !process.stdout.isTTY)) {
		throw new Error("Non-interactive Profile import requires --bind-current or --no-bind");
	}
	try {
		const record = await importProfile(options.source, {
			cwd: process.cwd(),
			name: options.name,
			replace: options.replace,
		});
		await offerBinding(record, options.bindCurrent);
		console.log(`Imported Profile ${record.displayName} (${record.id}). It will be available on the next launch.`);
	} catch (error) {
		if (!(error instanceof ProfileConflictError) || !process.stdin.isTTY || !process.stdout.isTTY) throw error;
		const choice = (await ask(`Profile ${error.profileId} exists. [r]eplace, re[n]ame, [c]ancel: `)).toLowerCase();
		if (choice === "r" || choice === "replace") {
			const record = await importProfile(options.source, {
				cwd: process.cwd(),
				name: options.name,
				replace: true,
			});
			await offerBinding(record, options.bindCurrent);
			console.log(`Replaced Profile ${record.displayName} (${record.id}).`);
			return;
		}
		if (choice === "n" || choice === "rename") {
			const name = await ask("New Profile name: ");
			if (!name) throw new Error("Import cancelled: Profile name is empty.");
			const record = await importProfile(options.source, {
				cwd: process.cwd(),
				name,
			});
			await offerBinding(record, options.bindCurrent);
			console.log(`Imported Profile ${record.displayName} (${record.id}).`);
			return;
		}
		console.log("Import cancelled.");
	}
}

export function isProfileCommand(args: string[]): boolean {
	return args[0] === "profile";
}

export async function handleMetaPiInitCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "init") return false;
	const manifestPath = join(process.cwd(), CONFIG_DIR_NAME, "metapi.json");
	if (existsSync(manifestPath)) {
		console.log(`MetaPi project manifest already exists: ${manifestPath}`);
		return true;
	}
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`, "utf8");
	console.log(`Created MetaPi project manifest: ${manifestPath}`);
	return true;
}

export async function handleProfileCommand(args: string[], requestedProfile?: string): Promise<boolean> {
	if (!isProfileCommand(args)) return false;

	const [, command = "status", ...rest] = args;
	if (command === "--help" || command === "-h" || command === "help") {
		printUsage();
		return true;
	}

	try {
		if (command === "list") {
			for (const name of listInstalledProfiles()) {
				const record = readProfileRecord(name);
				console.log(`${name}\t${record?.displayName ?? name}\t${getProfileAgentDir(name)}`);
			}
			const bindings = listDirectoryBindings();
			if (Object.keys(bindings).length > 0) {
				console.log("\nDirectory bindings:");
				for (const [directory, name] of Object.entries(bindings)) console.log(`${name}\t${directory}`);
			}
			return true;
		}

		if (command === "status") {
			console.log(formatProfileStatus(resolveProfile(process.cwd(), rest[0] ?? requestedProfile), process.cwd()));
			return true;
		}

		if (command === "import") {
			await runImport(rest);
			return true;
		}

		if (command === "export") {
			const name = rest[0];
			if (!name) throw new Error("Usage: metapi profile export <name> [directory]");
			console.log(
				chalk.yellow(
					"Profile export copies Bundle source files as-is. Managed credentials and Sessions are excluded, but hardcoded keys can still be included.",
				),
			);
			const result = await exportProfileWithAudit(name, rest[1] ?? `${name}-profile`, process.cwd());
			console.log(`Exported Profile ${name} to ${result.output}`);
			console.log(
				`Audit: ${result.audit.includedFiles.length} files, ${result.audit.findings.length} credential-like finding(s). Review ${result.audit.reportPath} before sharing.`,
			);
			return true;
		}

		if (command === "update") {
			const name = rest[0];
			if (!name) throw new Error("Usage: metapi profile update <name>");
			const record = await updateProfile(name, process.cwd());
			console.log(`Updated Profile ${record.displayName} (${record.packageVersion ?? "local"}).`);
			return true;
		}

		if (command === "plugins") {
			await runProfilePlugins(rest);
			return true;
		}

		if (command === "bind") {
			const directory = rest.length > 1 ? rest[0] : process.cwd();
			const name = rest.length > 1 ? rest[1] : rest[0];
			if (!name) throw new Error("Usage: metapi profile bind [directory] <name>");
			const path = bindDirectory(directory, name);
			console.log(`Bound ${path} to Profile ${name}. It applies to descendant directories.`);
			return true;
		}

		if (command === "unbind") {
			const removed = unbindDirectory(rest[0] ?? process.cwd());
			console.log(removed ? "Directory binding removed." : "No directory binding found.");
			return true;
		}

		printUsage();
		process.exitCode = 1;
		return true;
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
}
