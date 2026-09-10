import { defineTool, defineTool as defineTool$1 } from "@deepseek-ai/dsh-tools";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
//#region src/store.ts
/**
* dsh-npm — credential/registry store.
*
* Persists the npm registry override and (optional) auth token to
* ~/.dsh/dsh-npm.json (mode 0600). Reads are lazy and cached; the public
* view() never exposes the token. The config path can be overridden with
* DSH_NPM_CONFIG (used by the smoke tests).
*/
/** Default machine-wide config location (mode 0600). */
const DEFAULT_CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-npm.json");
/** Default registry when none is configured. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
/** Test override for the config location. */
function configPath() {
	const override = process.env.DSH_NPM_CONFIG;
	return override !== void 0 && override !== "" ? override : DEFAULT_CONFIG_FILE;
}
/** Mask a credential for display, keeping only the head and tail. */
function mask(value) {
	if (!value) return "";
	if (value.length <= 8) return value.slice(0, 2) + "****";
	return value.slice(0, 4) + "****" + value.slice(-4);
}
/** Empty config record. */
function empty() {
	return {
		registry: "",
		token: ""
	};
}
/**
* Registry credential/token store with lazy cached reads and masked views.
*/
var NpmStore = class {
	cached = null;
	/** Current file path (honors the DSH_NPM_CONFIG override). */
	file = configPath();
	/** Read the config (lazy, cached). */
	async read() {
		if (this.cached !== null) return this.cached;
		try {
			const raw = await readFile(this.file, "utf8");
			const obj = JSON.parse(raw) ?? {};
			this.cached = {
				registry: typeof obj.registry === "string" ? obj.registry : "",
				token: typeof obj.token === "string" ? obj.token : ""
			};
		} catch (error) {
			if (error.code === "ENOENT") this.cached = empty();
			else this.cached = empty();
		}
		return this.cached;
	}
	/** Effective registry base URL (configured or default). */
	async registry() {
		return normalizeRegistry((await this.read()).registry || "https://registry.npmjs.org/");
	}
	/** Whether an auth token is present. */
	async token() {
		return (await this.read()).token;
	}
	/** Effective registry host (for building npm userconfig auth lines). */
	async registryHost() {
		return new URL(await this.registry()).host;
	}
	/** Persist a patch (registry/token) or clear everything with reset. */
	async patch(patch) {
		const current = await this.read();
		let next;
		if (patch.reset === true) next = empty();
		else next = {
			registry: patch.registry !== void 0 ? normalizeRegistry(patch.registry) : current.registry,
			token: patch.token !== void 0 ? patch.token : current.token
		};
		await mkdir(path.dirname(this.file), { recursive: true });
		await writeFile(this.file, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
		this.cached = next;
		return this.view();
	}
	/** Public secret-free view. */
	async view() {
		const config = await this.read();
		const registry = normalizeRegistry(config.registry || "https://registry.npmjs.org/");
		return {
			configured: config.registry !== "" || config.token !== "",
			registry,
			registryConfigured: config.registry !== "",
			tokenConfigured: config.token !== "",
			tokenMasked: mask(config.token),
			configPath: this.file
		};
	}
};
/** Normalize a registry URL to a trailing-slash base URL. */
function normalizeRegistry(registry) {
	const trimmed = registry.trim();
	if (trimmed === "") return DEFAULT_REGISTRY;
	const withSlash = trimmed.endsWith("/") ? trimmed : trimmed + "/";
	if (!/^https?:\/\//.test(withSlash)) return "https://" + withSlash;
	return withSlash;
}
//#endregion
//#region src/registry.ts
/** Request timeout for registry calls (ms). */
const TIMEOUT_MS = 15e3;
/** Error raised for registry-level failures (not found, network, auth…). */
var NpmRegistryError = class extends Error {
	status;
	constructor(message, status = null) {
		super(message);
		this.status = status;
		this.name = "NpmRegistryError";
	}
};
/**
* Normalize a package name into the registry's URL path segment. Scoped
* names (@scope/name) must be encoded as a whole (@scope%2fname).
*/
function packagePath(name) {
	return encodeURIComponent(name).replace(/%2F/gi, "/").replace(/%2f/gi, "/");
}
/** Build the full metadata URL for a package. */
function packageUrl(base, name) {
	return base + packagePath(name);
}
/** One registry fetch with auth, timeout, and error normalization. */
async function fetchJson(url, token) {
	let response;
	try {
		response = await fetch(url, {
			headers: token !== void 0 && token !== "" ? {
				Authorization: "Bearer " + token,
				Accept: "application/json"
			} : { Accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		const cause = error;
		if (cause.name === "TimeoutError" || cause.name === "AbortError") throw new NpmRegistryError("请求超时（15000ms）：" + url);
		throw new NpmRegistryError("网络错误：" + cause.message);
	}
	if (response.status === 404) throw new NpmRegistryError("包不存在（404）：" + url);
	if (response.status === 401 || response.status === 403) throw new NpmRegistryError("registry 认证失败（" + response.status + "）：" + url + "。可能是私有包需要配置 token（npm_config token=…）或 token 无效。", response.status);
	if (!response.ok) throw new NpmRegistryError("registry 请求失败（HTTP " + response.status + "）：" + url, response.status);
	try {
		return await response.json();
	} catch {
		throw new NpmRegistryError("registry 返回了无法解析的内容：" + url);
	}
}
/** Resolve effective registry base for a call. */
async function resolveRegistry(store, explicit) {
	if (explicit !== void 0 && explicit.trim() !== "") return normalizeRegistry(explicit);
	return store.registry();
}
/** Resolve token for a call (explicit beats store). */
async function resolveToken(store, explicit) {
	if (explicit !== void 0 && explicit !== "") return explicit;
	return store.token();
}
/** Typed view of the raw registry metadata. */
function viewOf(raw, name) {
	const versions = raw.versions ?? {};
	const distTags = raw["dist-tags"] ?? {};
	const time = raw.time ?? {};
	const latest = versions[distTags.latest ?? ""] ?? {};
	const latestDependencies = latest.dependencies ?? {};
	const latestEngines = latest.engines ?? {};
	const keywords = raw.keywords ?? [];
	const authorRaw = raw.author;
	const repositoryRaw = raw.repository;
	return {
		name: String(raw.name ?? name),
		description: typeof raw.description === "string" ? raw.description : "",
		latestVersion: distTags.latest ?? "",
		distTags,
		versionCount: Object.keys(versions).length,
		license: typeof latest.license === "string" ? latest.license : typeof raw.license === "string" ? raw.license : "",
		author: typeof authorRaw === "string" ? authorRaw : typeof authorRaw?.name === "string" ? String(authorRaw.name) : "",
		homepage: typeof raw.homepage === "string" ? raw.homepage : "",
		repository: typeof repositoryRaw === "string" ? repositoryRaw : typeof repositoryRaw?.url === "string" ? String(repositoryRaw.url) : "",
		keywords: Array.isArray(keywords) ? keywords.slice(0, 20) : [],
		created: time.created ?? "",
		modified: time.modified ?? "",
		latestDependencies,
		latestEngines
	};
}
/** Fetch full package metadata. Throws NpmRegistryError on 404/network. */
async function getPackage(store, name, options = {}) {
	const base = await resolveRegistry(store, options.registry);
	const token = await resolveToken(store, options.token);
	return viewOf(await fetchJson(packageUrl(base, name), token), name);
}
/** List every published version with its publish time (latest tag first). */
async function getVersions(store, name, options = {}) {
	const base = await resolveRegistry(store, options.registry);
	const token = await resolveToken(store, options.token);
	const raw = await fetchJson(packageUrl(base, name), token);
	const versionsRaw = raw.versions ?? {};
	const time = raw.time ?? {};
	const distTags = raw["dist-tags"] ?? {};
	const latest = distTags.latest ?? "";
	return {
		versions: Object.keys(versionsRaw).map((version) => ({
			version,
			publishedAt: time[version] ?? ""
		})).sort((a, b) => {
			if (a.version === latest) return -1;
			if (b.version === latest) return 1;
			const aTime = a.publishedAt !== "" ? new Date(a.publishedAt).getTime() : 0;
			const bTime = b.publishedAt !== "" ? new Date(b.publishedAt).getTime() : 0;
			if (aTime !== bTime) return bTime - aTime;
			return b.version.localeCompare(a.version);
		}),
		distTags,
		name: String(raw.name ?? name)
	};
}
/** Search packages on the registry. Throws NpmRegistryError on failure. */
async function searchPackages(store, query, size, options = {}) {
	const base = await resolveRegistry(store, options.registry);
	const token = await resolveToken(store, options.token);
	const raw = await fetchJson(base + "-/v1/search?text=" + encodeURIComponent(query) + "&size=" + Math.max(1, Math.min(50, Math.floor(size))), token);
	const hits = (raw.objects ?? []).map((object) => {
		const pkg = object.package ?? {};
		const authorRaw = pkg.author;
		return {
			name: String(pkg.name ?? ""),
			version: String(pkg.version ?? ""),
			description: typeof pkg.description === "string" ? pkg.description : "",
			author: typeof authorRaw === "string" ? authorRaw : typeof authorRaw?.name === "string" ? String(authorRaw.name) : "",
			keywords: Array.isArray(pkg.keywords) ? pkg.keywords.slice(0, 10) : [],
			date: typeof pkg.date === "string" ? pkg.date : "",
			searchScore: typeof object.searchScore === "number" ? object.searchScore : 0
		};
	});
	return {
		hits,
		total: typeof raw.total === "number" ? raw.total : hits.length
	};
}
//#endregion
//#region src/publish.ts
/**
* dsh-npm — npm CLI wrapper for publish / deprecate.
*
* Runs the local `npm` executable. Authentication reuses the user's own
* ~/.npmrc by default; when the plugin store holds a token, it is injected
* through a temporary --userconfig file (mode 0600, removed after the run)
* so the token never appears on the command line or in logs.
*/
/** Default timeout for npm CLI runs (ms) — publishing uploads can be slow. */
const DEFAULT_TIMEOUT_MS = 18e4;
/**
* Well-known directories that hold a package manager on this machine.
*
* DSH can be launched by launchd (the shipped `com.dsh.web` service), whose
* PATH is only `/usr/bin:/bin`. A bare `npm` then dies with ENOENT even though
* it is installed, so every lookup also probes these absolute locations.
*/
function extraBinDirs() {
	const home = homedir();
	const dirs = [
		path.join(home, ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		path.join(home, ".bun", "bin"),
		path.join(home, ".volta", "bin"),
		path.join(home, ".npm-global", "bin"),
		"/usr/bin",
		"/bin"
	];
	for (const manager of [
		".nvm/versions/node",
		".local/share/fnm/node-versions",
		".asdf/installs/nodejs"
	]) {
		const root = path.join(home, manager);
		try {
			for (const entry of readdirSync(root)) dirs.push(path.join(root, entry, "bin"));
		} catch {}
	}
	return dirs;
}
/**
* Resolve an executable name to an absolute path.
* @param name - bare executable name (without a Windows extension).
* @returns the first existing absolute path, or the bare name so that the OS
*   still performs its own PATH lookup (and reports a meaningful error).
*/
function resolveExecutable(name) {
	const suffixes = process.platform === "win32" ? [
		".cmd",
		".exe",
		".bat",
		""
	] : [""];
	const seen = /* @__PURE__ */ new Set();
	for (const dir of [...(process.env.PATH ?? "").split(path.delimiter), ...extraBinDirs()]) {
		if (dir === "" || seen.has(dir)) continue;
		seen.add(dir);
		for (const suffix of suffixes) {
			const candidate = path.join(dir, name + suffix);
			if (existsSync(candidate)) return candidate;
		}
	}
	return name;
}
/** npm executable name (Windows needs the .cmd shim). */
function npmBin() {
	return resolveExecutable("npm");
}
/** Probe the local npm installation (fast, synchronous). */
function npmEnv() {
	const node = process.version;
	try {
		const result = spawnSync(npmBin(), ["--version"], {
			encoding: "utf8",
			timeout: 1e4
		});
		if (result.error !== void 0 || result.status !== 0) return {
			available: false,
			version: "",
			path: "",
			node
		};
		return {
			available: true,
			version: result.stdout.trim().split("\n")[0] ?? "",
			path: result.stdout.includes(npmBin()) ? "" : npmBin(),
			node
		};
	} catch {
		return {
			available: false,
			version: "",
			path: "",
			node
		};
	}
}
/**
* Run npm with optional token injection via a temporary userconfig.
* Never throws for non-zero exits — the caller inspects NpmRunResult.
*/
function runNpm(args, options = {}) {
	return new Promise((resolve) => {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		let cleanup;
		const finalArgs = [...args];
		const prepare = async () => {
			if (options.token !== void 0 && options.token !== "") {
				const dir = await mkdtemp(path.join(tmpdir(), "dsh-npm-"));
				const userconfig = path.join(dir, "npmrc");
				await writeFile(userconfig, ["//" + (options.registryHost ?? "registry.npmjs.org") + "/:_authToken=" + options.token, ""].join("\n"), { mode: 384 });
				finalArgs.push("--userconfig=" + userconfig);
				cleanup = async () => {
					await rm(dir, {
						recursive: true,
						force: true
					});
				};
			}
		};
		prepare().then(() => {
			const child = spawn(npmBin(), finalArgs, {
				cwd: options.cwd,
				env: {
					...process.env,
					npm_config_fund: "false",
					npm_config_audit: "false"
				},
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				]
			});
			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
			}, timeoutMs);
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString("utf8");
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString("utf8");
			});
			child.on("error", (error) => {
				clearTimeout(timer);
				const message = "无法启动 npm：" + error.message;
				cleanup?.();
				resolve({
					code: -1,
					stdout,
					stderr: stderr + message
				});
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				cleanup?.();
				resolve({
					code: code ?? -1,
					stdout,
					stderr
				});
			});
		}).catch((error) => {
			resolve({
				code: -1,
				stdout: "",
				stderr: "准备 npm 调用失败：" + error.message
			});
		});
	});
}
/** Publish a package via `npm publish`. */
function publishPackage(options) {
	const args = ["publish"];
	if (options.dir !== void 0 && options.dir !== "") args.push(options.dir);
	args.push("--json", "--no-fund", "--no-audit");
	if (options.tag !== void 0 && options.tag !== "") args.push("--tag", options.tag);
	if (options.access !== void 0 && options.access !== "") args.push("--access", options.access);
	if (options.otp !== void 0 && options.otp !== "") args.push("--otp", options.otp);
	if (options.registry !== void 0 && options.registry !== "") args.push("--registry", options.registry);
	if (options.dryRun === true) args.push("--dry-run");
	if (options.force === true) args.push("--force");
	return runNpm(args, {
		cwd: options.dir !== void 0 && options.dir !== "" ? options.dir : void 0,
		timeoutMs: options.timeoutMs,
		token: options.token,
		registryHost: options.registryHost
	});
}
/** Deprecate a package/version via `npm deprecate`. */
function deprecatePackage(spec, message, options = {}) {
	const args = [
		"deprecate",
		spec,
		message,
		"--no-fund",
		"--no-audit"
	];
	if (options.registry !== void 0 && options.registry !== "") args.push("--registry", options.registry);
	return runNpm(args, {
		timeoutMs: options.timeoutMs,
		token: options.token,
		registryHost: options.registryHost
	});
}
//#endregion
//#region src/tools.ts
/** One text content block (the only render shape these tools emit). */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Parse `npm publish --json` stdout into a PublishedRef (best effort). */
function parsePublishedOutput(stdout) {
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || !trimmed.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (typeof parsed.name === "string" && typeof parsed.version === "string") return {
				name: parsed.name,
				version: parsed.version,
				tag: typeof parsed.tag === "string" ? parsed.tag : ""
			};
		} catch {}
	}
	return null;
}
/** Escape a message for use as a single npm deprecate argument. */
function deprecateMessage(message) {
	return message.replace(/[\r\n]+/g, " ").trim();
}
/** Tool: connection/plugin status. */
function npmStatusTool(ctx) {
	return defineTool$1({
		name: "npm_status",
		description: "查看 dsh-npm 插件状态：生效的 registry、是否配置了 auth token（不回显完整 token）、本机 npm CLI 是否可用及其版本、配置路径。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					registry: { type: "string" },
					registryConfigured: { type: "boolean" },
					tokenConfigured: { type: "boolean" },
					tokenMasked: { type: "string" },
					npmAvailable: { type: "boolean" },
					npmVersion: { type: "string" },
					nodeVersion: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			const view = await ctx.store.view();
			const env = npmEnv();
			return {
				ok: true,
				message: "dsh-npm：" + [
					"registry：" + view.registry + (view.registryConfigured ? "（已配置）" : "（默认）"),
					"token：" + (view.tokenConfigured ? "已配置（" + view.tokenMasked + "）" : "未配置（查询公共包 / 用本机 ~/.npmrc 发布）"),
					"npm CLI：" + (env.available ? "可用（v" + env.version + "）" : "不可用（发布/弃用功能将无法使用）"),
					"node：" + env.node,
					"配置路径：" + view.configPath
				].join("；") + "。查询用 npm_info / npm_versions / npm_search，发布用 npm_publish。",
				registry: view.registry,
				registryConfigured: view.registryConfigured,
				tokenConfigured: view.tokenConfigured,
				tokenMasked: view.tokenMasked,
				npmAvailable: env.available,
				npmVersion: env.version,
				nodeVersion: env.node,
				configPath: view.configPath
			};
		}
	});
}
/** Tool: configure registry/token. */
function npmConfigTool(ctx) {
	return defineTool$1({
		name: "npm_config",
		description: "配置 dsh-npm：registry 为 npm registry 基础地址（如 https://registry.npmjs.org/ 或私有 registry，留空恢复默认）；token 为可选 npm auth token（发布私有包 / 查询私有包用，写入 ~/.dsh/dsh-npm.json，权限 0600，任何输出都不会回显完整 token）；传 reset: true 清除全部配置。",
		parameters: {
			registry: {
				type: "string",
				description: "registry 基础地址（默认 https://registry.npmjs.org/）"
			},
			token: {
				type: "string",
				description: "npm auth token（可选；发布/查询私有包时使用）"
			},
			reset: {
				type: "boolean",
				description: "设为 true 清除 registry 与 token 配置"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					registry: { type: "string" },
					registryConfigured: { type: "boolean" },
					tokenConfigured: { type: "boolean" },
					tokenMasked: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			const view = await ctx.store.patch(args);
			const parts = [];
			if (args.reset === true) parts.push("已清除全部配置");
			else {
				if (args.registry !== void 0) parts.push("registry → " + view.registry);
				if (args.token !== void 0) parts.push("token " + (args.token === "" ? "已清除" : "已保存（" + view.tokenMasked + "）"));
				if (args.registry === void 0 && args.token === void 0) parts.push("当前 registry：" + view.registry + "；token：" + (view.tokenConfigured ? "已配置（" + view.tokenMasked + "）" : "未配置"));
			}
			return {
				ok: true,
				message: "dsh-npm：" + parts.join("；") + "。配置存 " + view.configPath + "（0600）。",
				...view
			};
		}
	});
}
/** Tool: package info. */
function npmInfoTool(ctx) {
	return defineTool$1({
		name: "npm_info",
		description: "查询 npm 包信息（registry 元数据）：最新版本、dist-tags、描述、作者、license、homepage、仓库、创建/更新时间、版本总数、最新版依赖摘要。包不存在或网络错误会返回错误信息。",
		parameters: {
			name: {
				type: "string",
				description: "包名（支持 @scope/name）"
			},
			registry: {
				type: "string",
				description: "可选：本次查询使用的 registry 基础地址，覆盖插件配置"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					name: { type: "string" },
					description: { type: "string" },
					latestVersion: { type: "string" },
					distTags: { type: "json" },
					versionCount: { type: "number" },
					license: { type: "string" },
					author: { type: "string" },
					homepage: { type: "string" },
					repository: { type: "string" },
					keywords: { type: "array" },
					created: { type: "string" },
					modified: { type: "string" },
					latestDependencies: { type: "json" },
					latestEngines: { type: "json" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (typeof args.name !== "string" || args.name.trim() === "") return {
				ok: false,
				message: "请提供要查询的包名（name）。"
			};
			const name = args.name.trim();
			try {
				const info = await getPackage(ctx.store, name, { registry: args.registry });
				const tagLine = Object.entries(info.distTags).map(([tag, v]) => tag + "=" + v).join(", ");
				const depCount = Object.keys(info.latestDependencies).length;
				const depLine = depCount > 0 ? "依赖 " + depCount + " 项：" + Object.entries(info.latestDependencies).slice(0, 8).map(([d, r]) => d + "@" + r).join("、") + (depCount > 8 ? " 等" : "") : "无运行时依赖";
				const lines = [
					info.description !== "" ? info.description : "（无描述）",
					"最新版本：" + (info.latestVersion !== "" ? info.latestVersion : "?"),
					tagLine !== "" ? "dist-tags：" + tagLine : "",
					"版本总数：" + info.versionCount,
					"作者：" + (info.author !== "" ? info.author : "未知"),
					"license：" + (info.license !== "" ? info.license : "未知"),
					"更新时间：" + info.modified + "（创建于 " + info.created + "）",
					depLine,
					info.homepage !== "" ? "主页：" + info.homepage : "",
					info.repository !== "" ? "仓库：" + info.repository : "",
					info.keywords.length > 0 ? "关键词：" + info.keywords.join("、") : ""
				].filter((line) => line !== "");
				return {
					ok: true,
					message: "npm 包「" + name + "」：" + lines.join("；") + "。",
					...info
				};
			} catch (error) {
				if (error instanceof NpmRegistryError) return {
					ok: false,
					message: "npm_info 失败：" + error.message
				};
				return {
					ok: false,
					message: "npm_info 失败：" + error.message
				};
			}
		}
	});
}
/** Tool: version list. */
function npmVersionsTool(ctx) {
	return defineTool$1({
		name: "npm_versions",
		description: "列出 npm 包的全部已发布版本及发布时间（按发布时间倒序，最新在前），并给出 dist-tags。用于发布前确认目标版本是否已存在。",
		parameters: {
			name: {
				type: "string",
				description: "包名（支持 @scope/name）"
			},
			limit: {
				type: "number",
				description: "最多返回的版本数（默认 30，最大 200）"
			},
			registry: {
				type: "string",
				description: "可选：本次查询使用的 registry 基础地址"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					name: { type: "string" },
					distTags: { type: "json" },
					total: { type: "number" },
					versions: { type: "array" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (typeof args.name !== "string" || args.name.trim() === "") return {
				ok: false,
				message: "请提供要查询的包名（name）。"
			};
			const name = args.name.trim();
			const limit = typeof args.limit === "number" ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 30;
			try {
				const { versions, distTags } = await getVersions(ctx.store, name, { registry: args.registry });
				const shown = versions.slice(0, limit).map((v) => ({
					version: v.version,
					publishedAt: v.publishedAt
				}));
				const lines = shown.map((v) => v.version + (v.publishedAt !== "" ? "（" + v.publishedAt.slice(0, 10) + "）" : ""));
				return {
					ok: true,
					message: "npm 包「" + name + "」共 " + versions.length + " 个版本，dist-tags：" + Object.entries(distTags).map(([tag, v]) => tag + "=" + v).join(", ") + "；最近 " + shown.length + " 个：" + lines.join("、") + "。" + (versions.some((v) => v.version === (distTags.latest ?? "")) ? "" : "（注意：无 latest 标记）"),
					name,
					distTags,
					total: versions.length,
					versions: shown
				};
			} catch (error) {
				if (error instanceof NpmRegistryError) return {
					ok: false,
					message: "npm_versions 失败：" + error.message
				};
				return {
					ok: false,
					message: "npm_versions 失败：" + error.message
				};
			}
		}
	});
}
/** Tool: registry search. */
function npmSearchTool(ctx) {
	return defineTool$1({
		name: "npm_search",
		description: "在 npm registry 中搜索包：按相关度返回名称、最新版本、描述、作者、关键词与发布时间。",
		parameters: {
			query: {
				type: "string",
				description: "搜索关键词（支持多词）"
			},
			size: {
				type: "number",
				description: "返回条数（默认 10，最大 50）"
			},
			registry: {
				type: "string",
				description: "可选：本次查询使用的 registry 基础地址"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					query: { type: "string" },
					total: { type: "number" },
					hits: { type: "array" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (typeof args.query !== "string" || args.query.trim() === "") return {
				ok: false,
				message: "请提供搜索关键词（query）。"
			};
			const query = args.query.trim();
			const size = typeof args.size === "number" ? Math.max(1, Math.min(50, Math.floor(args.size))) : 10;
			try {
				const { hits, total } = await searchPackages(ctx.store, query, size, { registry: args.registry });
				const views = hits.map((hit) => ({
					name: hit.name,
					version: hit.version,
					description: hit.description,
					author: hit.author,
					keywords: hit.keywords,
					date: hit.date
				}));
				const lines = views.map((hit) => hit.name + "@" + hit.version + (hit.description !== "" ? " — " + hit.description.slice(0, 60) : "") + (hit.author !== "" ? "（" + hit.author + "）" : ""));
				return {
					ok: true,
					message: "搜索「" + query + "」共 " + total + " 个结果，前 " + views.length + " 个：\n" + lines.join("\n"),
					query,
					total,
					hits: views
				};
			} catch (error) {
				if (error instanceof NpmRegistryError) return {
					ok: false,
					message: "npm_search 失败：" + error.message
				};
				return {
					ok: false,
					message: "npm_search 失败：" + error.message
				};
			}
		}
	});
}
/** Tool: publish. */
function npmPublishTool(ctx) {
	return defineTool$1({
		name: "npm_publish",
		description: "发布 npm 包（真实执行 npm publish，不可随意撤销）。默认复用本机 ~/.npmrc 的登录凭据；若插件配置了 token 则用其发布。发布前建议先 npm_info / npm_versions 确认版本号不存在；dryRun: true 只做校验不实际上传；force: true 可强制覆盖已发布版本（危险，同名同版本发布后 npm 默认拒绝）。",
		parameters: {
			dir: {
				type: "string",
				description: "包目录（含 package.json；默认当前工作目录）"
			},
			tag: {
				type: "string",
				description: "dist-tag（默认 latest）"
			},
			access: {
				type: "string",
				description: "scoped 包访问级别：public 或 restricted"
			},
			otp: {
				type: "string",
				description: "两步验证一次性密码（2FA 账号需要）"
			},
			registry: {
				type: "string",
				description: "可选：本次发布使用的 registry 基础地址"
			},
			dryRun: {
				type: "boolean",
				description: "true 时仅预检（--dry-run），不实际上传"
			},
			force: {
				type: "boolean",
				description: "true 时强制覆盖已发布版本（危险，默认 false）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					dryRun: { type: "boolean" },
					force: { type: "boolean" },
					published: { type: "json" },
					output: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			const token = await ctx.store.token();
			const registryHost = await ctx.store.registryHost();
			const result = await publishPackage({
				dir: args.dir,
				tag: args.tag,
				access: args.access,
				otp: args.otp,
				registry: args.registry,
				dryRun: args.dryRun === true,
				force: args.force === true,
				token,
				registryHost
			});
			const stdoutTrimmed = result.stdout.trim();
			const stderrTrimmed = result.stderr.trim();
			if (result.code === 0) {
				const published = parsePublishedOutput(stdoutTrimmed);
				const label = args.dryRun === true ? "预检通过" : "发布成功";
				const detail = published !== null ? "「" + published.name + "@" + published.version + "」" + (published.tag !== "" ? "（tag: " + published.tag + "）" : "") : "";
				return {
					ok: true,
					message: "npm publish " + label + " " + detail + "。" + (stderrTrimmed !== "" ? "\n提示：" + stderrTrimmed.slice(0, 300) : ""),
					dryRun: args.dryRun === true,
					force: args.force === true,
					published,
					output: (stdoutTrimmed + "\n" + stderrTrimmed).slice(0, 4e3)
				};
			}
			const hint = /EPUBLISHCONFLICT/.test(stderrTrimmed) ? " 该版本已存在，如需覆盖请传 force: true（危险操作，请先确认）。" : /ENEEDAUTH|EOTP|401|403/.test(stderrTrimmed) ? " 认证失败：请先在本机执行 npm login，或用 npm_config 配置 token。" : "";
			return {
				ok: false,
				message: "npm publish 失败（退出码 " + result.code + "）：" + (stderrTrimmed.split("\n").pop() ?? "未知错误").slice(0, 400) + hint,
				dryRun: args.dryRun === true,
				force: args.force === true,
				published: null,
				output: (stdoutTrimmed + "\n" + stderrTrimmed).slice(0, 4e3)
			};
		}
	});
}
/** Tool: deprecate. */
function npmDeprecateTool(ctx) {
	return defineTool$1({
		name: "npm_deprecate",
		description: "标记 npm 包（或指定版本）为弃用（npm deprecate）：安装时会显示弃用警告。格式：spec 为 包名 或 包名@版本（如 my-pkg 或 my-pkg@1.0.0），message 为弃用说明。该操作会真实写入 registry，请谨慎使用。",
		parameters: {
			spec: {
				type: "string",
				description: "包名或 包名@版本（如 my-pkg、my-pkg@1.0.0）"
			},
			message: {
				type: "string",
				description: "弃用说明（安装时展示给使用者的文字）"
			},
			registry: {
				type: "string",
				description: "可选：本次操作使用的 registry 基础地址"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					output: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			if (typeof args.spec !== "string" || args.spec.trim() === "") return {
				ok: false,
				message: "请提供要弃用的包 spec（如 my-pkg 或 my-pkg@1.0.0）。"
			};
			if (typeof args.message !== "string" || args.message.trim() === "") return {
				ok: false,
				message: "请提供弃用说明（message）。"
			};
			const token = await ctx.store.token();
			const registryHost = await ctx.store.registryHost();
			const result = await deprecatePackage(args.spec.trim(), deprecateMessage(args.message), {
				registry: args.registry,
				token,
				registryHost
			});
			const stderrTrimmed = result.stderr.trim();
			if (result.code === 0) return {
				ok: true,
				message: "已标记弃用：" + args.spec.trim() + "（" + deprecateMessage(args.message) + "）。" + (stderrTrimmed !== "" ? " 提示：" + stderrTrimmed.slice(0, 300) : ""),
				output: (result.stdout + "\n" + stderrTrimmed).slice(0, 2e3)
			};
			return {
				ok: false,
				message: "npm deprecate 失败（退出码 " + result.code + "）：" + (stderrTrimmed.split("\n").pop() ?? "未知错误").slice(0, 400),
				output: (result.stdout + "\n" + stderrTrimmed).slice(0, 2e3)
			};
		}
	});
}
/** Build every tool for the registry. */
function buildTools(ctx) {
	return [
		npmStatusTool(ctx),
		npmConfigTool(ctx),
		npmInfoTool(ctx),
		npmVersionsTool(ctx),
		npmSearchTool(ctx),
		npmPublishTool(ctx),
		npmDeprecateTool(ctx)
	];
}
//#endregion
//#region src/routes.ts
/** Route paths. */
const NPM_API = {
	config: "/api/dsh-npm/config",
	info: "/api/dsh-npm/info",
	search: "/api/dsh-npm/search"
};
/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024;
/** Strict loopback fence for every route (the panel is same-origin only). */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
/** Read and parse a JSON request body (undefined when invalid). */
async function readJsonBody(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/** Build the route list for ctx.webServer.register. */
function makeRoutes(deps) {
	const { store } = deps;
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	/** Read query params as a string map. */
	const queryOf = (req) => {
		return new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
	};
	return [
		{
			kind: "exact",
			path: NPM_API.config,
			handler: async (req, res) => {
				const method = req.method ?? "GET";
				if (method === "GET") {
					if (!guard(req, res, "GET")) return;
					writeJson(res, 200, await store.view());
					return;
				}
				if (method === "POST") {
					if (!guard(req, res, "POST")) return;
					const body = await readJsonBody(req);
					if (body === void 0) {
						writeJson(res, 400, { error: "invalid JSON body" });
						return;
					}
					writeJson(res, 200, await store.patch(body));
					return;
				}
				writeJson(res, 405, { error: `method not allowed: ${method}` });
			}
		},
		{
			kind: "exact",
			path: NPM_API.info,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const params = queryOf(req);
				const name = (params.get("name") ?? "").trim();
				if (name === "") {
					writeJson(res, 400, {
						ok: false,
						error: "missing name"
					});
					return;
				}
				const options = {};
				const registry = (params.get("registry") ?? "").trim();
				if (registry !== "") options.registry = registry;
				try {
					writeJson(res, 200, {
						ok: true,
						info: await getPackage(store, name, options)
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						error: error instanceof NpmRegistryError ? error.message : error.message
					});
				}
			}
		},
		{
			kind: "exact",
			path: NPM_API.search,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const params = queryOf(req);
				const query = (params.get("q") ?? "").trim();
				if (query === "") {
					writeJson(res, 400, {
						ok: false,
						error: "missing q"
					});
					return;
				}
				const sizeRaw = Number(params.get("size") ?? "10");
				const size = Number.isFinite(sizeRaw) ? Math.max(1, Math.min(50, Math.floor(sizeRaw))) : 10;
				const options = {};
				const registry = (params.get("registry") ?? "").trim();
				if (registry !== "") options.registry = registry;
				try {
					const { hits, total } = await searchPackages(store, query, size, options);
					writeJson(res, 200, {
						ok: true,
						total,
						hits
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						error: error instanceof NpmRegistryError ? error.message : error.message
					});
				}
			}
		}
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "npm";
/** Services required before the npm surfaces can mount. */
const inject = [
	"tools",
	"systemPrompt",
	"webServer"
];
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 161;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const NPM_GUIDANCE = "本机已安装 dsh-npm 插件（NPM 包管理）：可用 npm_info 查询包信息（最新版本/dist-tags/依赖摘要）、npm_versions 列出全部版本及发布时间、npm_search 搜索 registry 上的包；npm_publish 真实执行 npm publish（默认复用本机 ~/.npmrc 登录凭据，也可用 npm_config 配置 registry 与 token，token 存 ~/.dsh/dsh-npm.json 权限 0600）；npm_deprecate 标记弃用；npm_status 查看插件状态。发布是真实写入 registry 的操作，发布前先用 npm_info / npm_versions 确认版本号不存在，建议先 dryRun: true 预检；force: true 可覆盖已发布版本（危险）。用户提到「npm / NPM / 发布包 / 查包 / 发包 / 搜索包」时即指本插件，请据此协作。";
/**
* Mount the npm tools and announcement.
* @param ctx - host plugin context carrying tools/systemPrompt.
* @param config - plugin config from the composition row.
*/
function apply(ctx, config) {
	const announceToAgent = config?.announceToAgent !== false;
	const enabled = config?.enabled !== false;
	const store = new NpmStore();
	const toolContext = { store };
	let disposeTools;
	let disposeRoutes;
	let disposeSection;
	const sync = () => {
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (!enabled) return;
		disposeTools = ctx.effect(() => {
			const disposers = buildTools(toolContext).map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-npm: tools");
		disposeRoutes = ctx.effect(() => {
			const disposers = makeRoutes({ store }).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-npm: routes");
		if (announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-npm",
			order: SECTION_ORDER,
			text: NPM_GUIDANCE
		});
	};
	sync();
}
//#endregion
export { DEFAULT_REGISTRY, NPM_API, NPM_GUIDANCE, NpmRegistryError, NpmStore, apply, buildTools, configPath, defineTool, deprecatePackage, getPackage, getVersions, inject, makeRoutes, mask, name, normalizeRegistry, npmConfigTool, npmDeprecateTool, npmEnv, npmInfoTool, npmPublishTool, npmSearchTool, npmStatusTool, npmVersionsTool, packageUrl, publishPackage, runNpm, searchPackages };
