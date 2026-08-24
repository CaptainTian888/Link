/**
 * Cloudflare Pages Function — /api/deploy
 *
 * 代替前端提交 links.json，GitHub Token 只存在于服务端环境变量，浏览器拿不到。
 *
 * 需要在 Cloudflare Pages → Settings → Variables and Secrets 配置：
 *   GITHUB_TOKEN     (Secret)  只授权本仓库、只给 Contents: Read and write 的 token
 *   ADMIN_AUTH_HASH  (Secret)  管理密码派生出的 auth token 的 SHA-256（十六进制小写）
 *
 * 可选覆盖（不配则用下面的默认值）：
 *   GH_OWNER / GH_REPO / GH_BRANCH / GH_PATH
 */

const DEFAULTS = {
    owner: 'CaptainTian888',
    repo: 'Link',
    branch: 'main',
    path: 'links.json'
};

const MAX_LINKS = 2000;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

/** UTF-8 字符串 → base64（分块，避免大内容时 spread 撑爆调用栈） */
function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
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

/**
 * 只接受本站的链接结构，避免这个接口被拿去写任意内容。
 * 逐条挑出白名单字段，多余字段直接丢弃。
 */
function sanitizeLinks(input) {
    if (!Array.isArray(input)) return { error: 'links 必须是数组' };
    if (input.length > MAX_LINKS) return { error: `链接数量超过 ${MAX_LINKS} 上限` };

    const out = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') return { error: '链接项必须是对象' };

        const id = String(item.id ?? '').slice(0, 64);
        const title = String(item.title ?? '').slice(0, 200);
        const url = String(item.url ?? '').slice(0, 2000);
        const description = String(item.description ?? '').slice(0, 500);
        const category = String(item.category ?? '').slice(0, 100);

        if (!id || !title || !url) return { error: '链接项缺少 id / title / url' };
        if (!/^https?:\/\//i.test(url)) return { error: `URL 协议不合法：${url.slice(0, 60)}` };

        out.push({ id, title, url, description, category });
    }
    return { links: out };
}

export async function onRequestPost({ request, env }) {
    if (!env.GITHUB_TOKEN || !env.ADMIN_AUTH_HASH) {
        return json({ error: '服务端未配置 GITHUB_TOKEN / ADMIN_AUTH_HASH' }, 500);
    }

    // ─── 鉴权 ─── //
    const auth = request.headers.get('X-Admin-Auth') || '';
    if (!auth) return json({ error: '缺少鉴权头' }, 401);

    const expected = env.ADMIN_AUTH_HASH.trim().toLowerCase();
    if (!timingSafeEqual(await sha256Hex(auth), expected)) {
        return json({ error: '鉴权失败' }, 401);
    }

    // ─── 请求体校验 ─── //
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const result = sanitizeLinks(body && body.links);
    if (result.error) return json({ error: result.error }, 400);

    const content = JSON.stringify({ links: result.links }, null, 2);

    const owner = env.GH_OWNER || DEFAULTS.owner;
    const repo = env.GH_REPO || DEFAULTS.repo;
    const branch = env.GH_BRANCH || DEFAULTS.branch;
    const path = env.GH_PATH || DEFAULTS.path;

    const ghHeaders = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'captain-link'
    };

    // ─── 取当前文件 SHA ─── //
    let sha = null;
    try {
        const getResp = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
            { headers: ghHeaders }
        );
        if (getResp.ok) {
            sha = (await getResp.json()).sha;
        } else if (getResp.status === 401 || getResp.status === 403) {
            return json({ error: `GitHub 拒绝了服务端 Token（${getResp.status}），请检查 GITHUB_TOKEN` }, 502);
        }
        // 404 = 文件还不存在，走新建流程
    } catch (e) {
        return json({ error: `读取 GitHub 文件失败：${e.message}` }, 502);
    }

    // ─── 提交 ─── //
    const putBody = {
        message: 'Auto-update links via Captain Link Admin',
        content: toBase64(content),
        branch,
        committer: { name: 'Captain Link Admin', email: 'admin@users.noreply.github.com' }
    };
    if (sha) putBody.sha = sha;

    let putResp;
    try {
        putResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
            method: 'PUT',
            headers: { ...ghHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
        });
    } catch (e) {
        return json({ error: `提交 GitHub 失败：${e.message}` }, 502);
    }

    if (!putResp.ok) {
        const err = await putResp.json().catch(() => ({}));
        return json({ error: err.message || `GitHub 返回 ${putResp.status}` }, 502);
    }

    const out = await putResp.json().catch(() => ({}));
    return json({ ok: true, count: result.links.length, commit: out.commit && out.commit.sha });
}
