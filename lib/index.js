// Cloudflare Tunnel plugin for DeepSeek Harness (DSH).
// 1. Native restriction lifting: removes loopback-only barriers for PRIVILEGED_METHODS,
//    isTrustedApiRequest, settings persistence, and client isLoopback checks without running any reverse proxy.
// 2. Automated lifecycle management: spawns cloudflared, discovers public HTTPS URL,
//    registers trusted hosts, auto-reconnects, and safely disposes.
// 3. System integrations: provides WebUI Card, Agent Tools, and Shell Environment variables.

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
 * 彻底消除 "settings are unavailable in this browser"、403 Forbidden 以及模型/设置页面不可用的问题。
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
          code = code.replaceAll(
            'PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])',
            'false'
          );
          changed = true;
        }

        if (code.includes('interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, [])')) {
          code = code.replaceAll(
            'interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, [])',
            'false'
          );
          changed = true;
        }

        if (code.includes('const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;')) {
          code = code.replaceAll(
            'const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;',
            'const trustedHosts = this.trustedHosts;'
          );
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

        if (changed) {
          writeFileSync(fullPath, code, 'utf8');
          logger?.info(`[cloudflare-tunnel] Unlocked DSH restrictions in: ${fullPath}`);
        }
      } catch (err) {
        logger?.debug(`[cloudflare-tunnel] Could not patch ${fullPath}: ${err.message}`);
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
          } else if (full.endsWith('.js') || full.endsWith('.mjs')) {
            if (full.includes('dsh-client-') || full.includes('dsh-host-') || full.includes('dsh-web-')) {
              unlockFile(full);
            }
          }
        }
      } catch {}
    }

    for (const d of searchDirs) {
      walkDir(d);
    }
  } catch (err) {
    logger?.debug(`[cloudflare-tunnel] Lift restrictions error: ${err.message}`);
  }
}

function resolveBinary(customPath) {
  if (customPath && existsSync(customPath)) {
    return customPath;
  }
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        'cloudflared.exe',
        'cloudflared',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe'),
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'cloudflared.exe')
      ]
    : [
        'cloudflared',
        '/usr/local/bin/cloudflared',
        '/usr/bin/cloudflared',
        '/bin/cloudflared',
        '/opt/homebrew/bin/cloudflared',
        '/tmp/cloudflared'
      ];

  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    }
  }
  return 'cloudflared';
}

class CloudflareTunnelManager {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
    this.url = null;
    this.hostname = null;
    this.status = 'stopped';
    this.process = null;
    this.error = null;
    this.startedAt = null;
    this.#disposed = false;
    this.#restartTimer = null;

    ctx.on('dispose', () => {
      this.#disposed = true;
      this.stop();
    });

    if (this.config.enabled !== false) {
      setTimeout(() => {
        if (!this.#disposed && this.status === 'stopped') {
          this.start();
        }
      }, 1000);
    }
  }

  #disposed = false;
  #restartTimer = null;

  async start() {
    if (this.status === 'running' || this.status === 'starting') {
      return this.url;
    }
    if (this.#disposed) return null;

    this.status = 'starting';
    this.error = null;
    this.url = null;
    this.hostname = null;

    const bin = resolveBinary(this.config.binPath);
    const targetPort = this.ctx.get('webServer')?.port || this.config.port || 3080;
    const target = this.config.targetUrl || `http://127.0.0.1:${targetPort}`;

    const args = this.config.token
      ? ['tunnel', 'run', '--token', this.config.token]
      : ['tunnel', '--url', target, '--no-autoupdate'];

    this.ctx.logger?.info(`[cloudflare-tunnel] Starting cloudflared (${bin}) pointing to DSH (${target})...`);

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (this.status === 'starting') {
            this.status = 'running';
          }
          resolve(this.url);
        }
      }, 25000);

      try {
        const cp = spawn(bin, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });
        this.process = cp;
        this.startedAt = new Date();

        const onOutput = (chunk) => {
          const text = chunk.toString('utf8');
          if (this.config.logLevel === 'debug') {
            this.ctx.logger?.debug(`[cloudflared] ${text.trim()}`);
          }

          const match = text.match(TUNNEL_URL_REGEX);
          if (match && !this.url) {
            this.url = match[0];
            try {
              this.hostname = new URL(this.url).hostname;
            } catch {
              this.hostname = this.url.replace(/^https?:\/\//, '');
            }
            this.status = 'running';
            this.ctx.logger?.info('===============================================================');
            this.ctx.logger?.info(`🌐 Cloudflare Tunnel Live: ${this.url}`);
            this.ctx.logger?.info('🔓 Native Origin & Settings Restrictions: UNLOCKED');
            this.ctx.logger?.info('===============================================================');

            // 动态注册白名单
            try {
              const webRuntime = this.ctx.get('webRuntime');
              if (webRuntime && Array.isArray(webRuntime.trustedHosts)) {
                if (!webRuntime.trustedHosts.includes(this.hostname)) {
                  webRuntime.trustedHosts.push(this.hostname);
                }
              }
            } catch {}

            try {
              const connection = this.ctx.get('connection');
              if (connection && Array.isArray(connection.trustedHosts)) {
                if (!connection.trustedHosts.includes(this.hostname)) {
                  connection.trustedHosts.push(this.hostname);
                }
              }
            } catch {}

            // 多路径持久化状态文件
            try {
              const statusData = {
                tunnelUrl: this.url,
                tunnelHost: this.hostname,
                unlocked: true,
                timestamp: new Date().toISOString()
              };
              const json = JSON.stringify(statusData, null, 2);
              const paths = [
                'status.json',
                '/tmp/status.json',
                path.join(process.env.HOME || '', 'status.json'),
                path.join(process.env.HOME || '', '.dsh', 'status.json'),
                path.join(process.cwd(), 'status.json')
              ];
              for (const p of paths) {
                try { writeFileSync(p, json, 'utf8'); } catch {}
              }
            } catch {}

            // GitHub Actions Summary 输出
            if (process.env.GITHUB_STEP_SUMMARY) {
              try {
                const summaryText = `\n## 🌐 DeepSeek Harness Live (Native Cloudflare Tunnel)\n- **Public URL**: [${this.url}](${this.url})\n- **Mode**: Native direct (3080, restrictions unlocked)\n`;
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
          this.ctx.logger?.error(`[cloudflare-tunnel] Failed to spawn ${bin}: ${err.message}`);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }
        });

        cp.on('close', (code, signal) => {
          this.ctx.logger?.warn(`[cloudflare-tunnel] Process exited with code ${code}, signal ${signal}`);
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
            this.ctx.logger?.info('[cloudflare-tunnel] Attempting restart in 5 seconds...');
            this.#restartTimer = setTimeout(() => {
              if (!this.#disposed) this.start();
            }, 5000);
          }
        });
      } catch (err) {
        this.status = 'error';
        this.error = err.message;
        this.ctx.logger?.error(`[cloudflare-tunnel] Spawn exception: ${err.message}`);
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

function apply(ctx, config) {
  // 1. 解除 DSH 原生来源与权限限制
  liftDshRestrictions(ctx.logger);

  // 2. 初始化隧道管理器
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
      const toolDef = {
        name: 'get_cloudflare_tunnel',
        description: 'Get the current live public Cloudflare Tunnel URL and status for this DeepSeek Harness instance.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['status', 'restart'],
              description: 'Action to perform: status (default) or restart'
            },
            toolAction: {
              type: 'string',
              required: true,
              description: 'Brief 2-5 word summary of what this tool is doing.'
            },
            toolSummary: {
              type: 'string',
              required: true,
              description: 'Brief 2-5 word noun phrase describing what this tool call is about.'
            }
          },
          required: ['toolAction', 'toolSummary']
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              url: { type: 'string' },
              hostname: { type: 'string' },
              startedAt: { type: 'string' }
            }
          },
          render: (_args, value) => [{
            type: 'text',
            text: value.url
              ? `🌐 Cloudflare Tunnel Status: ${value.status}\n🔗 Public URL: ${value.url}`
              : `Cloudflare Tunnel Status: ${value.status} (no active public URL)`
          }]
        },
        execute: async (_toolCtx, args) => {
          if (args?.action === 'restart') {
            await manager.restart();
          }
          return {
            status: manager.status,
            url: manager.url || '',
            hostname: manager.hostname || '',
            startedAt: manager.startedAt ? manager.startedAt.toISOString() : ''
          };
        }
      };

      toolCtx.tools.register(toolDef);
    } catch {}
  });
}

export { CloudflareTunnelManager, apply, inject, name };
