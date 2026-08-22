/**
 * DeepSeek Harness - 全透明反向代理 & 动态路由 Cloudflare Worker
 * 
 * 功能特点：
 * 1. 全透明反向代理（完全隐藏后端 trycloudflare 真实地址，支持 HTTP/WebSocket）
 * 2. 密码鉴权与 Cookie 记住登录状态（7天有效）
 * 3. 动态 KV 路由同步（接收 GitHub Action 的 /update 上报）
 * 4. 静态资源 Cloudflare Edge 边缘缓存加速
 * 
 * 环境变量配置（Cloudflare Worker -> Settings -> Variables and Secrets）：
 * 1. DSH_KV           : 绑定的 KV 命名空间（Variable name 填 DSH_KV）
 * 2. VISIT_PASSWORD   : 网页访问密码（如：my-secure-pwd-888）
 * 3. AUTH_TOKEN       : GitHub Action 上报专用 Token（如：cf_token_dsh_2026）
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const visitPassword = (env.VISIT_PASSWORD || env.AUTH_TOKEN || "admin888").trim();
    const authToken = (env.AUTH_TOKEN || env.VISIT_PASSWORD || "dsh-secret-token").trim();

    // ----------------------------------------------------
    // 1. Action 上报接口: POST /update (使用 AUTH_TOKEN 校验)
    // ----------------------------------------------------
    if (request.method === "POST" && url.pathname === "/update") {
      const authHeader = request.headers.get("Authorization") || request.headers.get("X-Auth-Token");
      if (authHeader !== `Bearer ${authToken}` && authHeader !== authToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      try {
        const body = await request.json();
        const tunnelUrl = body.url;
        if (!tunnelUrl || !tunnelUrl.startsWith("https://")) {
          return new Response(JSON.stringify({ error: "Invalid tunnel URL" }), { status: 400 });
        }

        const data = {
          url: tunnelUrl,
          updatedAt: new Date().toISOString(),
          port: body.port || 3080,
          status: "online"
        };

        if (env.DSH_KV) {
          await env.DSH_KV.put("latest_tunnel", JSON.stringify(data));
        }

        return new Response(JSON.stringify({ ok: true, message: "Tunnel URL updated successfully", data }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ----------------------------------------------------
    // 2. 退出登录: GET /logout
    // ----------------------------------------------------
    if (url.pathname === "/logout") {
      return new Response("已退出登录", {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": "dsh_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"
        }
      });
    }

    // ----------------------------------------------------
    // 3. 处理网页登录表单提交: POST /login
    // ----------------------------------------------------
    if (request.method === "POST" && url.pathname === "/login") {
      const formData = await request.formData();
      const pwd = (formData.get("password") || "").trim();

      if (pwd === visitPassword || pwd === authToken) {
        const tokenHash = await sha256(visitPassword);
        return new Response(null, {
          status: 302,
          headers: {
            "Location": "/",
            // 保持登录 7 天
            "Set-Cookie": `dsh_auth=${tokenHash}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`
          }
        });
      } else {
        return new Response(renderLoginHtml("密码错误，请重新输入"), {
          status: 401,
          headers: { "Content-Type": "text/html;charset=UTF-8" }
        });
      }
    }

    // ----------------------------------------------------
    // 4. 身份鉴权拦截（检查 Cookie 或 Query Key）
    // ----------------------------------------------------
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookies = Object.fromEntries(cookieHeader.split(";").map(c => c.trim().split("=")));
    const tokenHash = await sha256(visitPassword);

    const queryKey = url.searchParams.get("key");
    const isAuthed = cookies["dsh_auth"] === tokenHash || queryKey === visitPassword;

    if (!isAuthed) {
      return new Response(renderLoginHtml(), {
        status: 401,
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    // ----------------------------------------------------
    // 5. 认证通过：获取最新隧道地址
    // ----------------------------------------------------
    let data = null;
    if (env.DSH_KV) {
      const raw = await env.DSH_KV.get("latest_tunnel");
      if (raw) {
        try { data = JSON.parse(raw); } catch (e) {}
      }
    }

    // 无在线实例
    if (!data || !data.url) {
      return new Response(renderOfflineHtml(), {
        status: 503,
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    // 状态查询接口
    if (url.pathname === "/status") {
      return new Response(renderStatusHtml(data), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    if (url.pathname === "/json") {
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // ----------------------------------------------------
    // 6. 全透明反向代理（核心：彻底隐藏隧道 URL，支持 WebSocket 与流式）
    // ----------------------------------------------------
    const target = new URL(data.url);
    const proxyUrl = new URL(request.url);
    proxyUrl.protocol = target.protocol;
    proxyUrl.host = target.host;
    proxyUrl.port = target.port;

    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set("Host", target.host);
    proxyHeaders.set("X-Forwarded-Host", url.host);
    proxyHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

    // 处理 WebSocket 升级（DSH 实时对话、终端流式通信）
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return fetch(proxyUrl.toString(), {
        method: request.method,
        headers: proxyHeaders,
      });
    }

    // 处理普通 HTTP / API / 静态资源请求
    const isStatic = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|wasm)$/i.test(url.pathname);
    const fetchOptions = {
      method: request.method,
      headers: proxyHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    };

    // 对 JS/CSS 等静态资源开启 Cloudflare Edge 缓存，极速加载并节省请求额度
    if (isStatic) {
      fetchOptions.cf = {
        cacheEverything: true,
        cacheTtl: 86400, // 缓存 24 小时
      };
    }

    return fetch(proxyUrl.toString(), fetchOptions);
  }
};

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message + "_dsh_salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function renderLoginHtml(error = "") {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DeepSeek Harness - 访问验证</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem 2rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); max-width: 380px; width: 90%; text-align: center; border: 1px solid #334155; }
    .logo { width: 48px; height: 48px; background: #3b82f6; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem 0; }
    p { color: #94a3b8; font-size: 0.875rem; margin: 0 0 1.5rem 0; }
    input[type="password"] { width: 100%; padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid #475569; background: #0f172a; color: white; font-size: 1rem; margin-bottom: 1rem; outline: none; }
    input[type="password"]:focus { border-color: #3b82f6; }
    button { width: 100%; background: #3b82f6; color: white; border: none; padding: 0.75rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #2563eb; }
    .error { background: #ef444420; color: #f87171; padding: 0.5rem; border-radius: 0.375rem; font-size: 0.875rem; margin-bottom: 1rem; border: 1px solid #ef444440; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡</div>
    <h1>DeepSeek Harness</h1>
    <p>请输入访问密码以继续</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="访问密码" autofocus required>
      <button type="submit">解 锁 访 问</button>
    </form>
  </div>
</body>
</html>`;
}

function renderStatusHtml(data) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DeepSeek Harness Router</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem; border-radius: 1rem; max-width: 480px; width: 90%; text-align: center; border: 1px solid #334155; }
    .badge { display: inline-block; background: #22c55e20; color: #4ade80; padding: 4px 12px; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; border: 1px solid #22c55e40; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.875rem; }
    a.btn { display: inline-block; margin-top: 1.5rem; background: #3b82f6; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">● Online</div>
    <h1>DeepSeek Harness</h1>
    <p>实例已在线，已通过全透明反代接入：</p>
    <p style="background: #0f172a; padding: 0.75rem; border-radius: 0.5rem; font-family: monospace; color: #38bdf8;">更新时间: ${data.updatedAt}</p>
    <a href="/" class="btn">进入 Web 页面</a>
    <div style="margin-top: 1rem;"><a href="/logout" style="color: #64748b; font-size: 0.75rem; text-decoration: underline;">退出登录</a></div>
  </div>
</body>
</html>`;
}

function renderOfflineHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Service Offline - DeepSeek Harness</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem; border-radius: 1rem; max-width: 420px; width: 90%; text-align: center; border: 1px solid #334155; }
    .badge { display: inline-block; background: #ef444420; color: #f87171; padding: 4px 12px; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; border: 1px solid #ef444440; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">● Offline</div>
    <h2>DeepSeek Harness 离线</h2>
    <p style="color: #94a3b8; font-size: 0.875rem;">当前没有活跃的 Action 实例正在运行，请在 GitHub 触发 Action 后重试。</p>
    <div style="margin-top: 1rem;"><a href="/logout" style="color: #64748b; font-size: 0.75rem; text-decoration: underline;">退出登录</a></div>
  </div>
</body>
</html>`;
}
