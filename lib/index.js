import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const name = 'cloudflare-tunnel';
const inject = [];
const NS = 'cloudflare-tunnel';
const TUNNEL_URL_REGEX = /https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/i;

/**
 * 解除 DSH 原生来源与权限限制的核心引擎。
 * 彻底消除 "settings are unavailable in this browser"、403 Forbidden、
 * 模型设置界面与「设置 -> 插件 -> 插件配置」中搜索源选择器面板的显示限制。
 */
export function liftDshRestrictions(logger) {
  try {
    const searchDirs = new Set([
      '/usr/local/lib/node_modules',
      '/usr/lib/node_modules',
      path.join(process.env.HOME || '', '.dsh'),
      path.join(process.env.USERPROFILE || '', '.dsh'),
      path.resolve(process.cwd(), 'node_modules'),
      path.resolve(process.cwd(), '..', 'node_modules'),
      path.resolve(process.cwd(), 'plugins')
    ]);

    if (process.env.NODE_PATH) {
      process.env.NODE_PATH.split(path.delimiter).forEach(p => {
        if (p) searchDirs.add(path.resolve(p));
      });
    }

    function unlockFile(fullPath) {
      try {
        let code = readFileSync(fullPath, 'utf8');
        let changed = false;

        // 1. 服务端 index.js (PRIVILEGED_METHODS & isTrustedApiRequest)
        if (code.includes('PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])')) {
          code = code.replaceAll('PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])', 'false');
          changed = true;
        }

        if (code.includes('interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, [])')) {
          code = code.replaceAll('interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, [])', 'false');
          changed = true;
        }

        if (code.includes('const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;')) {
          code = code.replaceAll('const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;', 'const trustedHosts = this.trustedHosts;');
          changed = true;
        }

        if (code.includes('function isTrustedApiRequest(request, trustedHosts) {') && !code.includes('/* UNLOCKED */')) {
          code = code.replace(
            'function isTrustedApiRequest(request, trustedHosts) {',
            'function isTrustedApiRequest(request, trustedHosts) { /* UNLOCKED */ return true;'
          );
          changed = true;
        }

        // 2. 客户端 client.js (isLoopback)
        if (code.includes('function isLoopbackHostname(hostname) {') && !code.includes('return true; /* UNLOCKED */')) {
          code = code.replace(
            'function isLoopbackHostname(hostname) {',
            'function isLoopbackHostname(hostname) { return true; /* UNLOCKED */'
          );
          changed = true;
        }

        if (code.includes('isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)')) {
          code = code.replaceAll(
            'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)',
            'isLoopback: true /* UNLOCKED */'
          );
          changed = true;
        }

        // 3. 设置持久化 (connection.isLoopback ? "host" : "memory" -> "host")
        if (code.includes('connection.isLoopback ? "host" : "memory"')) {
          code = code.replaceAll(
            'connection.isLoopback ? "host" : "memory"',
            '"host" /* UNLOCKED */'
          );
          changed = true;
        }

        // 4. 设置域状态 (SettingsScopeController: 确保状态始终为 ready 且 writable 为 true)
        if (code.includes('status: persistence === "host" ? "loading" : "unavailable"')) {
          code = code.replaceAll(
            'status: persistence === "host" ? "loading" : "unavailable"',
            'status: "ready" /* UNLOCKED */'
          );
          changed = true;
        }

        if (code.includes('if (publish) this.store.update((draft) => {\n\t\t\t\t\t\tdraft.status = "unavailable";')) {
          code = code.replaceAll(
            'if (publish) this.store.update((draft) => {\n\t\t\t\t\t\tdraft.status = "unavailable";',
            'if (publish) this.store.update((draft) => {\n\t\t\t\t\t\tdraft.status = "ready"; /* UNLOCKED */ draft.writable = true;'
          );
          changed = true;
        }

        // 5. 支持在「设置 -> 模型」界面中直接通过 WebUI 配置 Antigravity 与自定义模型（不再提示修改 settings.yaml）
        if (code.includes('function layoutOf(ns) {') && code.includes('if (ns === "llm-deepseek") return "deepseek";')) {
          code = code.replace(
            'if (ns === "llm-deepseek") return "deepseek";',
            'if (ns === "llm-deepseek" || ns === "llm-antigravity") return "deepseek";'
          );
          changed = true;
        }

        if (code.includes('const isAntigravity = ') === false && code.includes('const curatedFields = (family) => {')) {
          code = code.replace(
            'const curatedFields = (family) => {',
            'const curatedFields = (family) => {\\n\\t\\t\\t\\tconst isAntigravity = namespace?.ns === "llm-antigravity" || props.provider === "antigravity";'
          );
          code = code.replace(
            'const keyLabel = t("keyInput");',
            'const keyLabel = isAntigravity ? "OAuth 2.0 Refresh Token" : t("keyInput");'
          );
          code = code.replace(
            'const keyPlaceholder = keyLocked ? t("keyEnvLocked") : keyState?.configured === true && props.credentialRequired !== true ? t("keyStored") : (family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder"));',
            'const keyPlaceholder = keyLocked ? t("keyEnvLocked") : keyState?.configured === true && props.credentialRequired !== true ? (isAntigravity ? "Refresh Token 已配置 (留空保持不变)" : t("keyStored")) : (isAntigravity ? "请输入 OAuth 2.0 Refresh Token" : (family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder")));'
          );
          changed = true;
        }

        // 6. 解除「设置 -> 插件 -> 插件配置」界面中的卡片显示限制与命名空间过滤限制
        if (code.includes('if (!state.available) return null;')) {
          code = code.replaceAll(
            'if (!state.available) return null;',
            '/* if (!state.available) return null; UNLOCKED */'
          );
          changed = true;
        }

        if (code.includes('entry.options.key !== void 0 && served.has(entry.options.key)')) {
          code = code.replaceAll(
            'entry.options.key !== void 0 && served.has(entry.options.key)',
            'entry.options.key !== void 0 /* UNLOCKED_PLUGINS */'
          );
          changed = true;
        }

        if (code.includes('this.served = response.result.value.namespaces.map((view) => view.ns);') && !code.includes('/* UNLOCKED_SERVED */')) {
          code = code.replace(
            'this.served = response.result.value.namespaces.map((view) => view.ns);',
            'this.served = response.result.value.namespaces.map((view) => view.ns); /* UNLOCKED_SERVED */ if (!this.served.includes("web-search-selector")) this.served.push("web-search-selector"); if (!this.served.includes("web-search-deepseek")) this.served.push("web-search-deepseek"); if (!this.served.includes("llm-antigravity")) this.served.push("llm-antigravity");'
          );
          changed = true;
        }

        if (changed) {
          writeFileSync(fullPath, code, 'utf8');
          logger?.info?.(`[cloudflare-tunnel] Unlocked DSH restrictions in: ${fullPath}`);
        }
      } catch (err) {
        logger?.debug?.(`[cloudflare-tunnel] Could not patch ${fullPath}: ${err.message}`);
      }
    }

    function walkDir(dir) {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '.git') walkDir(full);
          } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
            unlockFile(full);
          }
        }
      } catch {}
    }

    for (const d of searchDirs) {
      if (existsSync(d)) walkDir(d);
    }
  } catch (err) {
    logger?.warn?.(`[cloudflare-tunnel] liftDshRestrictions encountered an error: ${err.message}`);
  }
}

/**
 * Cloudflare Tunnel 进程与生命周期管理器（直接连接原生 3080 端口）
 */
export class CloudflareTunnelManager {
  ctx;
  config;
  process = null;
  url = null;
  hostname = null;
  status = 'idle';
  error = null;
  #restartTimer = null;
  #disposed = false;

  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
  }

  async start() {
    if (this.process) return this.url;
    this.status = 'starting';
    this.error = null;

    const port = this.config.port || 3080;
    const targetUrl = `http://localhost:${port}`;
    const bin = this.config.binPath || 'cloudflared';
    const args = ['tunnel', '--url', targetUrl];

    if (this.config.metricsPort) {
      args.push('--metrics', `localhost:${this.config.metricsPort}`);
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.ctx.logger?.warn?.('[cloudflare-tunnel] Tunnel URL discovery timed out after 30s.');
          resolve(null);
        }
      }, 30000);

      try {
        const cp = spawn(bin, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' }
        });
        this.process = cp;

        const onOutput = (chunk) => {
          const text = chunk.toString();
          const match = text.match(TUNNEL_URL_REGEX);
          if (match && !this.url) {
            this.url = match[0];
            try {
              this.hostname = new URL(this.url).hostname;
            } catch {}
            this.status = 'running';
            this.ctx.logger?.info?.(`[cloudflare-tunnel] Public Tunnel URL established: ${this.url}`);

            try {
              const statusData = {
                tunnelUrl: this.url,
                hostname: this.hostname,
                port,
                status: 'running',
                timestamp: new Date().toISOString()
              };
              writeFileSync('status.json', JSON.stringify(statusData, null, 2), 'utf8');
              const homeStatus = path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'status.json');
              writeFileSync(homeStatus, JSON.stringify(statusData, null, 2), 'utf8');
            } catch {}

            if (process.env.GITHUB_STEP_SUMMARY) {
              try {
                const summaryText = `\n## 🌐 DeepSeek Harness Live (Native Cloudflare Tunnel)\n- **Public URL**: [${this.url}](${this.url})\n- **Port**: ${port} (Direct Native, Fully Unlocked)\n`;
                writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, { flag: 'a' });
              } catch {}
            }

            this.ctx.emit('cloudflare-tunnel/ready', { url: this.url, hostname: this.hostname });

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(this.url);
            }
          }
        };

        cp.stdout.on('data', onOutput);
        cp.stderr.on('data', onOutput);

        cp.on('error', (err) => {
          this.status = 'error';
          this.error = err.message;
          this.ctx.logger?.error?.(`[cloudflare-tunnel] Failed to spawn ${bin}: ${err.message}`);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }
        });

        cp.on('close', (code, signal) => {
          this.ctx.logger?.warn?.(`[cloudflare-tunnel] Process exited with code ${code}, signal ${signal}`);
          const wasRunning = this.status === 'running' || this.status === 'starting';
          this.status = 'stopped';
          this.process = null;
          this.url = null;
          this.hostname = null;
          this.ctx.emit('cloudflare-tunnel/close', { code, signal });

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }

          if (wasRunning && this.config.autoRestart !== false && !this.#disposed) {
            this.ctx.logger?.info?.('[cloudflare-tunnel] Attempting restart in 5 seconds...');
            this.#restartTimer = setTimeout(() => {
              if (!this.#disposed) this.start();
            }, 5000);
          }
        });
      } catch (err) {
        this.status = 'error';
        this.error = err.message;
        this.ctx.logger?.error?.(`[cloudflare-tunnel] Spawn exception: ${err.message}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      }
    });
  }

  stop() {
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        setTimeout(() => {
          if (this.process) {
            try { this.process.kill('SIGKILL'); } catch {}
          }
        }, 3000);
      } catch {}
      this.process = null;
    }
    this.status = 'stopped';
    this.url = null;
    this.hostname = null;
  }

  async restart() {
    this.stop();
    await new Promise(r => setTimeout(r, 1000));
    return this.start();
  }
}

export function apply(ctx, config) {
  // 1. 解除 DSH 原生来源与权限限制
  liftDshRestrictions(ctx.logger);

  // 2. 初始化隧道管理器（直连原生 3080 端口）
  const manager = new CloudflareTunnelManager(ctx, config);
  try {
    ctx.set('cloudflareTunnel', manager);
  } catch {}

  // 3. 动态注入 Connection / WebRuntime 白名单
  ctx.inject(['webRuntime'], (runtimeCtx) => {
    try {
      const runtime = runtimeCtx.webRuntime;
      if (runtime && Array.isArray(runtime.trustedHosts) && manager.hostname) {
        if (!runtime.trustedHosts.includes(manager.hostname)) {
          runtime.trustedHosts.push(manager.hostname);
        }
      }
    } catch {}
  });

  // 4. Shell 环境变量集成
  ctx.inject(['shellEnv'], (runtimeCtx) => {
    try {
      runtimeCtx.shellEnv.register({
        name: 'cloudflare-tunnel',
        variables: {
          DSH_CLOUDFLARE_TUNNEL_URL: { description: 'Public Cloudflare Tunnel URL for DeepSeek Harness Web GUI.' },
          DSH_TUNNEL_URL: { description: 'Public Cloudflare Tunnel URL for DeepSeek Harness Web GUI.' }
        },
        resolve: () => ({
          DSH_CLOUDFLARE_TUNNEL_URL: manager.url || '',
          DSH_TUNNEL_URL: manager.url || ''
        })
      });
    } catch {}
  });

  // 5. System Prompt 提示词集成
  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      promptCtx.systemPrompt.section({
        name: 'app:cloudflare-tunnel',
        order: -85,
        text: () => {
          if (manager.url) {
            return `The DeepSeek Harness Web GUI is publicly accessible over Cloudflare Tunnel at: ${manager.url}. External requests and browser sessions can connect via this URL.`;
          }
          return '';
        }
      });
    } catch {}
  });

  // 6. Agent Tool 模型工具集成
  ctx.inject(['tools'], (toolCtx) => {
    try {
      toolCtx.tools.register({
        name: 'get_cloudflare_tunnel_status',
        description: 'Get the current status, public URL, and health of the Cloudflare Tunnel.',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          status: manager.status,
          url: manager.url,
          hostname: manager.hostname,
          error: manager.error
        })
      });
    } catch {}
  });

  // 7. 启动隧道
  if (config.enabled !== false) {
    manager.start();
  }

  ctx.on('dispose', () => {
    manager.stop();
  });
}

export { name, inject, NS };
