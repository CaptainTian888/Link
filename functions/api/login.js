/**
 * Cloudflare Pages Function — /api/login
 *
 * 校验管理密码。前端把密码经 PBKDF2 派生成 auth token 后发过来，
 * 这里只比对它的 SHA-256，服务端不保存也拿不到明文密码。
 *
 * 需要的环境变量：
 *   ADMIN_AUTH_HASH  (Secret)  auth token 的 SHA-256（十六进制小写）
 */

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

async function sha256Hex(str) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 定长比较，避免按字节提前返回导致的时序泄漏 */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function onRequestPost({ request, env }) {
    if (!env.ADMIN_AUTH_HASH) {
        return json({ error: '服务端未配置 ADMIN_AUTH_HASH' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const auth = body && body.auth;
    if (typeof auth !== 'string' || !auth) {
        return json({ ok: false, error: '密码错误' }, 401);
    }

    const expected = env.ADMIN_AUTH_HASH.trim().toLowerCase();
    if (!timingSafeEqual(await sha256Hex(auth), expected)) {
        return json({ ok: false, error: '密码错误' }, 401);
    }

    return json({ ok: true });
}
