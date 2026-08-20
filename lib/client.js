(function() {
	const NS = "cloudflare-tunnel";

	const en = {
		title: "Cloudflare Tunnel",
		description: "Expose your DeepSeek Harness instance publicly with automatic HTTPS via Cloudflare Tunnel.",
		statusLabel: "Tunnel Status",
		statusRunning: "🟢 Running",
		statusStarting: "🟡 Starting…",
		statusStopped: "🔴 Stopped",
		statusError: "⚠️ Error",
		publicUrlLabel: "Public URL",
		copyUrl: "Copy URL",
		copied: "Copied!",
		noUrl: "No public URL active (tunnel not running)",
		enabledLabel: "Auto-start Tunnel",
		enabledHint: "Automatically launch Cloudflare Tunnel when DeepSeek Harness starts.",
		portLabel: "Local Port",
		portHint: "Local port exposed by the tunnel (default: 3080).",
		tokenLabel: "Named Tunnel Token (Optional)",
		tokenPlaceholder: "Leave blank to use Quick Tunnel (trycloudflare.com)",
		tokenHint: "Optional token for Cloudflare Zero Trust named tunnels.",
		overridden: "Overridden",
		reset: "Reset to default",
		save: "Save",
		saving: "Saving…",
		discard: "Discard",
		unsaved: "Unsaved",
		saveFailed: "Failed to save tunnel settings.",
		readOnly: "Settings are read-only."
	};

	const zh = {
		title: "Cloudflare 隧道公网穿透",
		description: "通过 Cloudflare Tunnel 将本地 DeepSeek Harness Web 实例安全暴露至公网（自动 HTTPS）。",
		statusLabel: "隧道状态",
		statusRunning: "🟢 运行中",
		statusStarting: "🟡 启动中…",
		statusStopped: "🔴 已停止",
		statusError: "⚠️ 异常",
		publicUrlLabel: "公网访问域名",
		copyUrl: "复制链接",
		copied: "已复制！",
		noUrl: "暂无公网链接（隧道未启动）",
		enabledLabel: "随 DSH 自动启动",
		enabledHint: "启动 DeepSeek Harness 时自动创建并保持 Cloudflare 隧道连接。",
		portLabel: "本地暴露端口",
		portHint: "隧道映射的本地服务端口（默认: 3080）。",
		tokenLabel: "命名隧道 Token（可选）",
		tokenPlaceholder: "留空使用临时隧道 (trycloudflare.com)",
		tokenHint: "Cloudflare Zero Trust 自定义域名命名隧道的 Token（可选）。",
		overridden: "已覆盖",
		reset: "恢复默认",
		save: "保存",
		saving: "保存中…",
		discard: "放弃修改",
		unsaved: "未保存",
		saveFailed: "保存设置失败，请重试。",
		readOnly: "本部署的设置为只读。"
	};

	const factory = (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react_jsx_runtime = require("react/jsx-runtime");
		const react = require("react");
		const _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");

		function CloudflareTunnelCard(props) {
			const [open, setOpen] = react.useState(true);
			const [copied, setCopied] = react.useState(false);
			const { t } = props;
			const state = props.useCloudflareTunnelCard((snapshot) => snapshot);
			const disabled = !state.writable;

			const currentEnabled = state.draftEnabled ?? state.effectiveEnabled ?? true;
			const currentPort = state.draftPort ?? state.effectivePort ?? 3080;
			const currentToken = state.draftToken ?? state.effectiveToken ?? "";

			const dirty = (state.draftEnabled !== void 0 && state.draftEnabled !== state.effectiveEnabled) ||
			              (state.draftPort !== void 0 && state.draftPort !== state.effectivePort) ||
			              (state.draftToken !== void 0 && state.draftToken !== state.effectiveToken);

			const copyToClipboard = () => {
				const url = typeof location !== 'undefined' && location.origin.includes('trycloudflare.com')
					? location.origin
					: (state.tunnelUrl || '');
				if (url && navigator.clipboard) {
					navigator.clipboard.writeText(url).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					});
				}
			};

			const displayUrl = typeof location !== 'undefined' && location.origin.includes('trycloudflare.com')
				? location.origin
				: (state.tunnelUrl || t("noUrl"));

			return (0, react_jsx_runtime.jsxs)("li", {
				style: {
					borderRadius: 12,
					border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
					background: "var(--dsw-alias-bg-layer-2, #ffffff)",
					marginBottom: 16,
					overflow: "hidden",
					listStyle: "none"
				},
				children: [
					(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							width: "100%",
							padding: "16px 20px",
							background: "none",
							border: "none",
							cursor: "pointer",
							textAlign: "left"
						},
						onClick: () => setOpen(!open),
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "flex", alignItems: "center", gap: 8 },
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #111827)" },
												children: t("title")
											}),
											(0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 11,
													padding: "1px 8px",
													borderRadius: 999,
													background: typeof location !== 'undefined' && location.origin.includes('trycloudflare.com') ? "#dcfce7" : "var(--dsw-alias-bg-module-platform, #f3f4f6)",
													color: typeof location !== 'undefined' && location.origin.includes('trycloudflare.com') ? "#15803d" : "var(--dsw-alias-label-secondary, #6b7280)",
													fontWeight: 500
												},
												children: typeof location !== 'undefined' && location.origin.includes('trycloudflare.com') ? t("statusRunning") : t("statusStopped")
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #6b7280)", marginTop: 4 },
										children: t("description")
									})
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: { display: "flex", alignItems: "center", gap: 8 },
								children: [
									dirty ? (0, react_jsx_runtime.jsx)("span", {
										style: { fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--dsw-alias-brand-subtle, #e0f2fe)", color: "var(--dsw-alias-brand-primary, #0284c7)" },
										children: t("unsaved")
									}) : null,
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
										style: { transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }
									})
								]
							})
						]
					}),
					open ? (0, react_jsx_runtime.jsxs)("div", {
						style: { padding: "0 20px 20px 20px", borderTop: "1px solid var(--dsw-alias-border-l3, #f3f4f6)" },
						children: [
							// Public URL Box
							(0, react_jsx_runtime.jsxs)("div", {
								style: {
									margin: "16px 0",
									padding: "12px 16px",
									borderRadius: 8,
									background: "var(--dsw-alias-bg-layer-3, #f9fafb)",
									border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 12
								},
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { minWidth: 0, flex: 1 },
										children: [
											(0, react_jsx_runtime.jsx)("div", {
												style: { fontSize: 11, fontWeight: 600, color: "var(--dsw-alias-label-secondary, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em" },
												children: t("publicUrlLabel")
											}),
											(0, react_jsx_runtime.jsx)("div", {
												style: {
													fontSize: 13,
													fontFamily: "monospace",
													color: "var(--dsw-alias-brand-primary, #0284c7)",
													fontWeight: 600,
													marginTop: 2,
													wordBreak: "break-all"
												},
												children: displayUrl
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											padding: "6px 12px",
											borderRadius: 6,
											border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
											background: copied ? "#dcfce7" : "var(--dsw-alias-bg-layer-2, #ffffff)",
											color: copied ? "#15803d" : "var(--dsw-alias-label-primary, #111827)",
											fontSize: 12,
											fontWeight: 500,
											cursor: "pointer",
											flexShrink: 0
										},
										onClick: copyToClipboard,
										children: copied ? t("copied") : t("copyUrl")
									})
								]
							}),

							// Settings Form
							(0, react_jsx_runtime.jsxs)("div", {
								style: { display: "flex", flexDirection: "column", gap: 14 },
								children: [
									// Port Input
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "flex", flexDirection: "column", gap: 4 },
										children: [
											(0, react_jsx_runtime.jsx)("label", {
												style: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary, #111827)" },
												children: t("portLabel")
											}),
											(0, react_jsx_runtime.jsx)("input", {
												type: "number",
												style: {
													height: 36,
													borderRadius: 8,
													border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
													background: "var(--dsw-alias-bg-layer-3, #ffffff)",
													padding: "0 12px",
													fontSize: 13,
													color: "var(--dsw-alias-label-primary, #111827)"
												},
												value: currentPort,
												disabled,
												onChange: (e) => props.setPort(Number(e.target.value))
											}),
											(0, react_jsx_runtime.jsx)("p", {
												style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #9ca3af)", margin: 0 },
												children: t("portHint")
											})
										]
									}),

									// Token Input
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "flex", flexDirection: "column", gap: 4 },
										children: [
											(0, react_jsx_runtime.jsx)("label", {
												style: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary, #111827)" },
												children: t("tokenLabel")
											}),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												style: {
													height: 36,
													borderRadius: 8,
													border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
													background: "var(--dsw-alias-bg-layer-3, #ffffff)",
													padding: "0 12px",
													fontSize: 13,
													color: "var(--dsw-alias-label-primary, #111827)"
												},
												value: currentToken,
												placeholder: t("tokenPlaceholder"),
												disabled,
												onChange: (e) => props.setToken(e.target.value)
											}),
											(0, react_jsx_runtime.jsx)("p", {
												style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #9ca3af)", margin: 0 },
												children: t("tokenHint")
											})
										]
									})
								]
							}),

							// Save / Discard Actions
							(0, react_jsx_runtime.jsxs)("div", {
								style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
								children: [
									dirty ? (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											padding: "6px 14px",
											borderRadius: 6,
											border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
											background: "none",
											fontSize: 12,
											cursor: "pointer",
											color: "var(--dsw-alias-label-secondary, #4b5563)"
										},
										onClick: props.discard,
										children: t("discard")
									}) : null,
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											padding: "6px 14px",
											borderRadius: 6,
											border: "none",
											background: "var(--dsw-alias-brand-primary, #0284c7)",
											color: "#ffffff",
											fontSize: 12,
											fontWeight: 500,
											cursor: dirty ? "pointer" : "default",
											opacity: dirty ? 1 : 0.5
										},
										disabled: !dirty || disabled || state.saving,
										onClick: props.save,
										children: t(state.saving ? "saving" : "save")
									})
								]
							})
						]
					}) : null
				]
			});
		}

		class CloudflareTunnelController {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.draft = {};
				this.saving = false;
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
				scope.subscribe(() => {
					this.store.set(this.projection());
				});
			}

			projection() {
				const snapshot = this.scope.getSnapshot();
				const effective = snapshot.value ?? {};
				return {
					writable: snapshot.writable,
					effectiveEnabled: effective.enabled ?? true,
					effectivePort: effective.port ?? 3080,
					effectiveToken: effective.token ?? "",
					draftEnabled: this.draft.enabled,
					draftPort: this.draft.port,
					draftToken: this.draft.token,
					tunnelUrl: typeof location !== 'undefined' ? location.origin : '',
					saving: this.saving
				};
			}

			setPort(val) {
				this.draft.port = val;
				this.store.set(this.projection());
			}

			setToken(val) {
				this.draft.token = val;
				this.store.set(this.projection());
			}

			discard() {
				this.draft = {};
				this.store.set(this.projection());
			}

			async reset() {
				this.draft = {};
				try {
					await this.api.settings.mutate({
						ns: NS,
						ops: [
							{ op: "delete", path: ["port"] },
							{ op: "delete", path: ["token"] },
							{ op: "delete", path: ["enabled"] }
						]
					});
				} catch (e) {
					console.error(e);
				}
				this.store.set(this.projection());
			}

			async save() {
				if (Object.keys(this.draft).length === 0) return;
				this.saving = true;
				this.store.set(this.projection());
				try {
					const ops = [];
					if (this.draft.port !== void 0) ops.push({ op: "set", path: ["port"], value: this.draft.port });
					if (this.draft.token !== void 0) ops.push({ op: "set", path: ["token"], value: this.draft.token });
					if (this.draft.enabled !== void 0) ops.push({ op: "set", path: ["enabled"], value: this.draft.enabled });
					await this.api.settings.mutate({ ns: NS, ops });
					this.draft = {};
				} catch (e) {
					console.error(e);
				} finally {
					this.saving = false;
					this.store.set(this.projection());
				}
			}

			inject() {
				return {
					hooks: { cloudflareTunnelCard: this.store },
					setPort: (val) => this.setPort(val),
					setToken: (val) => this.setToken(val),
					save: () => this.save(),
					discard: () => this.discard(),
					reset: () => this.reset()
				};
			}
		}

		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope"
		];

		function apply(ctx) {
			const { api } = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cloudflare-tunnel: locales");

			const controller = new CloudflareTunnelController(
				ctx.settingsScope.bind({ namespace: NS }),
				api
			);

			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: NS,
					locale: NS,
					inject: () => controller.inject()
				}, CloudflareTunnelCard);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	};

	const ids = [
		"dsh-cloudflare-tunnel",
		"./plugins/dsh-cloudflare-tunnel",
		"plugins/dsh-cloudflare-tunnel",
		"./plugins/dsh-cloudflare-tunnel/lib/index.js",
		"plugins/dsh-cloudflare-tunnel/lib/index.js"
	];

	if (typeof window !== "undefined" && window.__ModuleLoader__) {
		for (const id of ids) {
			try {
				window.__ModuleLoader__.load({ id, factory });
			} catch (e) {}
		}
	}
})();
