window.__ModuleLoader__.load({
	id: "dsh-npm",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** Error carrying the route's JSON error message. */
		var NpmApiError = class extends Error {
			constructor(message) {
				super(message);
				this.name = "NpmApiError";
			}
		};
		/** Parse a JSON response or throw an NpmApiError. */
		async function readJson(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new NpmApiError(`HTTP ${response.status}: invalid JSON response`);
			}
			if (!response.ok) throw new NpmApiError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
			return body;
		}
		/** Plain fetch helper with an error wrapper. */
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new NpmApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		/** The npm panel API. */
		var NpmApi = class {
			async getConfig() {
				return request("/api/dsh-npm/config");
			}
			async setConfig(patch) {
				return request("/api/dsh-npm/config", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patch)
				});
			}
			async info(name, registry) {
				const params = new URLSearchParams({ name });
				if (registry !== void 0 && registry !== "") params.set("registry", registry);
				return request("/api/dsh-npm/info?" + params.toString());
			}
			async search(query, size, registry) {
				const params = new URLSearchParams({ q: query });
				if (size !== void 0) params.set("size", String(size));
				if (registry !== void 0 && registry !== "") params.set("registry", registry);
				return request("/api/dsh-npm/search?" + params.toString());
			}
		};
		//#endregion
		//#region src/client/NpmSettingsPanel.tsx
		/**
		* NPM settings panel — rendered inside the web settings page
		* (settings.section entry). Connection setup (registry URL, auth token
		* with masked echo), quick package lookup (latest version, description,
		* timestamps), and registry search. Plain React, inline styles only.
		*/
		/** Module-level API client (stateless; the component closes over it). */
		const api = new NpmApi();
		/** One shared style sheet (kept tiny and theme-agnostic). */
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "620px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: {
				fontWeight: 600,
				fontSize: "13px",
				margin: 0
			},
			status: {
				fontSize: "12px",
				opacity: .85
			},
			statusWarn: {
				fontSize: "12px",
				opacity: .9,
				color: "#c9763a"
			},
			row: {
				display: "flex",
				gap: "6px",
				alignItems: "center"
			},
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px"
			},
			button: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(128,128,128,0.4)",
				background: "rgba(128,128,128,0.14)",
				color: "inherit",
				fontSize: "12px",
				whiteSpace: "nowrap"
			},
			flex: { flex: 1 },
			msg: {
				fontSize: "12px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				opacity: .9
			},
			hint: {
				fontSize: "11px",
				opacity: .75,
				lineHeight: 1.6
			},
			hitRow: {
				display: "flex",
				gap: "8px",
				alignItems: "baseline",
				fontSize: "12px",
				padding: "3px 0",
				borderBottom: "1px solid rgba(128,128,128,0.12)"
			},
			hitName: {
				fontWeight: 600,
				whiteSpace: "nowrap"
			},
			hitDesc: {
				flex: 1,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			hitMeta: {
				opacity: .7,
				fontSize: "11px",
				whiteSpace: "nowrap"
			}
		};
		/** Status line for the current config view. */
		function statusText(view) {
			if (view === null) return "加载中…";
			return ["registry：" + view.registry + (view.registryConfigured ? "（已配置）" : "（默认）"), "token：" + (view.tokenConfigured ? "已配置（" + view.tokenMasked + "）" : "未配置")].join(" · ");
		}
		/** Short date label (YYYY-MM-DD). */
		function dateLabel(value) {
			if (value === "") return "";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			return date.toISOString().slice(0, 10);
		}
		/** The settings panel component. */
		function NpmSettingsPanel() {
			const [view, setView] = (0, react.useState)(null);
			const [registry, setRegistry] = (0, react.useState)("");
			const [token, setToken] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const [lookupName, setLookupName] = (0, react.useState)("");
			const [lookup, setLookup] = (0, react.useState)(null);
			const [lookupBusy, setLookupBusy] = (0, react.useState)(false);
			const [lookupMsg, setLookupMsg] = (0, react.useState)("");
			const [query, setQuery] = (0, react.useState)("");
			const [hits, setHits] = (0, react.useState)([]);
			const [searchTotal, setSearchTotal] = (0, react.useState)(0);
			const [searchBusy, setSearchBusy] = (0, react.useState)(false);
			const [searchMsg, setSearchMsg] = (0, react.useState)("");
			const refreshConfig = (0, react.useCallback)(async () => {
				try {
					const next = await api.getConfig();
					setView(next);
					setRegistry(next.registry);
				} catch (error) {
					setMsg("读取配置失败: " + String(error instanceof Error ? error.message : error));
				}
			}, []);
			(0, react.useEffect)(() => {
				refreshConfig();
			}, [refreshConfig]);
			/** Run one async panel action with busy/message bookkeeping. */
			const run = async (action) => {
				setBusy(true);
				setMsg("");
				try {
					const message = await action();
					if (message !== void 0) setMsg(message);
				} catch (error) {
					setMsg("操作失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			const save = () => {
				run(async () => {
					const next = await api.setConfig({
						registry,
						token
					});
					setView(next);
					setToken("");
					return next.configured ? "已保存：registry → " + next.registry + "；token " + (next.tokenConfigured ? "已配置（" + next.tokenMasked + "）" : "未配置") + "。" : "配置已保存（为空）。";
				});
			};
			const clear = () => {
				run(async () => {
					const next = await api.setConfig({ reset: true });
					setView(next);
					setRegistry("");
					setToken("");
					return "registry 与 token 已清除。";
				});
			};
			const doLookup = () => {
				const name = lookupName.trim();
				if (name === "") return;
				setLookupBusy(true);
				setLookupMsg("");
				api.info(name).then((result) => {
					if (result.ok && result.info !== void 0) setLookup(result.info);
					else {
						setLookup(null);
						setLookupMsg(result.error ?? "查询失败");
					}
				}).catch((error) => {
					setLookup(null);
					setLookupMsg(String(error instanceof Error ? error.message : error));
				}).finally(() => setLookupBusy(false));
			};
			const doSearch = () => {
				const q = query.trim();
				if (q === "") return;
				setSearchBusy(true);
				setSearchMsg("");
				api.search(q, 8).then((result) => {
					if (result.ok) {
						setHits(result.hits ?? []);
						setSearchTotal(result.total ?? 0);
					} else {
						setHits([]);
						setSearchTotal(0);
						setSearchMsg(result.error ?? "搜索失败");
					}
				}).catch((error) => {
					setHits([]);
					setSearchTotal(0);
					setSearchMsg(String(error instanceof Error ? error.message : error));
				}).finally(() => setSearchBusy(false));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: s.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.title,
						children: "NPM"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: view !== null && view.tokenConfigured ? s.status : s.statusWarn,
						children: statusText(view)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							"登录方式：① 在终端执行 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "npm login" }),
							"（凭据写入 ~/.npmrc，发布自动复用）；② 在 npmjs.com 生成 Publish token 填到下方（存 ~/.dsh/dsh-npm.json，权限 0600，不回显完整 token）。token 有有效期，过期后重新生成即可。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						style: s.input,
						placeholder: "registry（默认 https://registry.npmjs.org/，如 https://registry.npmmirror.com）",
						value: registry,
						onChange: (event) => setRegistry(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						style: s.input,
						type: "password",
						placeholder: "token（" + (view !== null && view.tokenConfigured ? "已配置，留空保持不变" : "npm_xxx…") + "）",
						value: token,
						onChange: (event) => setToken(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: save,
							disabled: busy,
							children: "保存"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: clear,
							disabled: busy || !(view !== null && view.configured),
							children: "清除"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
						height: "1px",
						background: "rgba(128,128,128,0.2)",
						margin: "2px 0"
					} }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.hint,
						children: "快捷查包（等价于 npm_info）："
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: {
								...s.input,
								...s.flex
							},
							placeholder: "包名，如 express",
							value: lookupName,
							onChange: (event) => setLookupName(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") doLookup();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: doLookup,
							disabled: lookupBusy || lookupName.trim() === "",
							children: "查询"
						})]
					}),
					lookup !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: lookup.name }),
							"@",
							lookup.latestVersion,
							" · 共 ",
							lookup.versionCount,
							" 个版本",
							lookup.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" — ", lookup.description] }),
							"\n",
							"作者 ",
							lookup.author || "未知",
							" · license ",
							lookup.license || "未知",
							" · 更新于 ",
							dateLabel(lookup.modified),
							lookup.homepage !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" · 主页 ", lookup.homepage] })
						]
					}),
					lookupMsg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.msg,
						children: lookupMsg
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.hint,
						children: "快捷搜索（等价于 npm_search）："
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: {
								...s.input,
								...s.flex
							},
							placeholder: "关键词，如 react hooks",
							value: query,
							onChange: (event) => setQuery(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") doSearch();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: s.button,
							onClick: doSearch,
							disabled: searchBusy || query.trim() === "",
							children: "搜索"
						})]
					}),
					hits.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							"前 ",
							hits.length,
							" 个结果（共 ",
							searchTotal,
							"）："
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: hits.map((hit) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hitRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: s.hitName,
								children: [
									hit.name,
									"@",
									hit.version
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: s.hitDesc,
								title: hit.description,
								children: hit.description
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: s.hitMeta,
								children: [hit.author, hit.date !== "" && " · " + dateLabel(hit.date)]
							})
						]
					}, hit.name)) })] }),
					searchMsg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.msg,
						children: searchMsg
					}),
					msg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.msg,
						children: msg
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots"];
		/**
		* Register the NPM settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "npm",
					order: 315,
					label: () => "NPM"
				}, NpmSettingsPanel));
			} catch (error) {
				console.warn("[dsh-npm] settings panel registration failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map