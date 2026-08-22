# Cloudflare Tunnel Plugin for DeepSeek Harness (dsh-cloudflare-tunnel)

通过 Cloudflare Tunnel 将本地/远程运行的 DeepSeek Harness Web 实例安全暴露至公网（自动获取 `https://*.trycloudflare.com` 域名，免公网 IP 与端口映射）。

---

## 🌟 功能特性

- **一键免配置穿透（Quick Tunnel）**：无需 Cloudflare 账号，自动启动并获取临时公网 HTTPS 访问域名。
- **支持自定义命名隧道（Named Tunnel）**：支持填入 Cloudflare Zero Trust Tunnel Token，绑定自有域名与固定 URL。
- **自动注册受信任域名（Trusted Hosts）**：隧道启动并分配域名后，自动将主机名加入 DSH API 信任列表，避免 403 Forbidden。
- **环境变量与系统提示词注入**：
  - Agent 终端环境自动注入 `DSH_CLOUDFLARE_TUNNEL_URL` 与 `DSH_TUNNEL_URL`。
  - System Prompt 自动提示 Agent 当前实例的公网访问地址。
- **Agent 工具支持**：内置 `get_cloudflare_tunnel` 工具，Agent 可按需查询公网连接状态与重启隧道。
- **WebUI 插件设置卡片**：在 WebUI 设置中直接查看当前公网域名、运行状态，并提供一键复制链接按钮。
- **生命周期托管**：跟随 DSH 进程启动与退出（Cordis Dispose），无残留孤儿进程；支持意外断连自动重连。

---

## 📦 安装与配置

### 1. 复制插件到 DSH 插件目录

```bash
# 将 dsh-cloudflare-tunnel 复制到 DSH profile 的插件目录
cp -r plugins/dsh-cloudflare-tunnel ~/.dsh/profiles/web/node_modules/
cp -r plugins/dsh-cloudflare-tunnel ~/.dsh/profiles/web/plugins/
```

### 2. 在 `cordis.patch.yml` 中声明

在配置文件 `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 列表中添加：

```yaml
- insert:
    - id: cloudflare-tunnel
      name: dsh-cloudflare-tunnel
      config:
        enabled: true
        port: 3080
        # token: "your-cloudflare-tunnel-token" # 可选：命名隧道 Token
        # binPath: "/usr/local/bin/cloudflared" # 可选：指定 cloudflared 路径
```

---

## ⚙️ 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | 是否在 DSH 启动时自动开启 Cloudflare Tunnel |
| `port` | `number` | `3080` | 本地需要暴露的 WebUI 端口 |
| `targetUrl` | `string` | `http://127.0.0.1:3080` | 目标本地服务完整 URL |
| `token` | `string` | `""` | Cloudflare Zero Trust 命名隧道 Token（留空则使用 Quick Tunnel） |
| `binPath` | `string` | `""` | 自定义 `cloudflared` 可执行文件路径 |
| `autoRestart` | `boolean` | `true` | 隧道意外中断时是否自动尝试重新连接 |
| `logLevel` | `string` | `"info"` | 日志级别：`info` / `warn` / `error` / `debug` |

---

## 🤖 Agent 工具调用示例

Agent 可以直接调用内置工具查询或重启隧道：

```json
{
  "name": "get_cloudflare_tunnel",
  "arguments": {
    "action": "status",
    "toolAction": "Checking Cloudflare Tunnel status",
    "toolSummary": "Tunnel Status Check"
  }
}
```

**返回结果**：
```json
{
  "status": "running",
  "url": "https://example-subdomain.trycloudflare.com",
  "hostname": "example-subdomain.trycloudflare.com",
  "startedAt": "2026-08-20T07:25:30.000Z"
}
```

---

## 🌐 Cloudflare Worker 动态路由与固定域名入口

仓库内置了两套 Cloudflare Worker 脚本（位于根目录），支持在 GitHub Actions 或本地启动隧道后**自动上报并同步最新公网地址**，实现使用固定域名访问：

1. **`cloudflare-worker.js` (动态跳转网关)**：
   - 带有网页登录密码鉴权（可配置 7 天记住登录状态）；
   - 接收 Action 的 `POST /update` 上报最新隧道地址并写入 Cloudflare KV；
   - 用户访问 Worker 固定域名时自动重定向到最新临时实例。
2. **`cloudflare-worker-proxy.js` (全透明反向代理)**：
   - 全透明反向代理，完全隐藏后端真实 `trycloudflare.com` 地址；
   - 完整支持 WebSocket（流式传输）与 Edge 边缘静态资源加速。
