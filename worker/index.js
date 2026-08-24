/**
 * Captain Link — Worker 入口
 *
 * 静态资源由 ASSETS 绑定直接服务；只有 /api/* 走下面的逻辑。
 * GitHub Token 与管理密码哈希都只存在于 Worker 的环境变量里，浏览器拿不到。
 *
 * 需要在 Worker → Settings → Variables and Secrets 配置：
 *   GITHUB_TOKEN     (Secret)  只授权本仓库、只给 Contents: Read and write 的 token
 *   ADMIN_AUTH_HASH  (Secret)  管理密码派生出的 auth token 的 SHA-256（十六进制小写）
 *
 * 可选覆盖：GH_OWNER / GH_REPO / GH_BRANCH / GH_PATH
 */

const DEFAULTS = {
    owner: 'CaptainTian888',
    repo: 'Link',
    branch: 'main',
    path: 'links.json'
};

const MAX_LINKS = 2000;

/* 子域名探测：证书透明度日志查询慢且常抽风，结果缓存 6 小时 */
const CT_TIMEOUT_MS = 20000;
const SUBDOMAIN_CACHE_SECONDS = 6 * 3600;
const MAX_SUBDOMAINS = 300;

/* 按顺序尝试，第一个成功的即采用。crt.sh 经常 502，所以放在备选位 */
const CT_SOURCES = [
    {
        name: 'certspotter',
        url: d => `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(d)}` +
                  '&include_subdomains=true&expand=dns_names',
        extract: entries => entries.flatMap(e => Array.isArray(e.dns_names) ? e.dns_names : [])
    },
    {
        name: 'crt.sh',
        url: d => `https://crt.sh/?q=${encodeURIComponent('%.' + d)}&output=json`,
        extract: entries => entries.flatMap(e => String(e.name_value || '').split('\n'))
    }
];

/* ==================== 工具 ==================== */

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

/** 校验 X-Admin-Auth / body.auth 是否匹配 ADMIN_AUTH_HASH */
async function authOk(env, auth) {
    if (typeof auth !== 'string' || !auth) return false;
    return timingSafeEqual(await sha256Hex(auth), env.ADMIN_AUTH_HASH.trim().toLowerCase());
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

/** 取末两段作为一级域名，与前端 hostname.split('.').length <= 2 的判断保持一致 */
function rootDomainOf(hostname) {
    const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

/* ==================== /api/subdomains ==================== */

/**
 * 从证书透明度日志反查某个一级域名签发过的子域名（certSpotter 为主，crt.sh 兜底）。
 *
 * 这是公开接口，所以只接受 links.json 里已经出现过的一级域名 ——
 * 否则就成了任何人都能拿来扫描任意域名的开放代理。
 */
async function handleSubdomains(request, env, ctx) {
    const url = new URL(request.url);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();

    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.length > 253) {
        return json({ error: '域名格式不合法' }, 400);
    }

    /* 白名单校验：必须是本站已收录链接的一级域名 */
    const known = await knownRootDomains(request, env);
    if (!known.has(domain)) {
        return json({ error: '该域名不在本站收录范围内' }, 403);
    }

    /* 命中缓存直接返回 */
    const cacheKey = new Request(`${url.origin}/api/subdomains?domain=${domain}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let rawNames = null;
    let usedSource = null;
    let rateLimited = false;
    const failures = [];

    for (const source of CT_SOURCES) {
        try {
            const resp = await fetch(source.url(domain), {
                headers: { 'User-Agent': 'captain-link', 'Accept': 'application/json' },
                signal: AbortSignal.timeout(CT_TIMEOUT_MS)
            });
            if (!resp.ok) {
                if (resp.status === 429) rateLimited = true;
                failures.push(`${source.name} 返回 ${resp.status}`);
                continue;
            }

            const entries = await resp.json();
            if (!Array.isArray(entries)) { failures.push(`${source.name} 返回了非预期格式`); continue; }

            rawNames = source.extract(entries);
            usedSource = source.name;
            break;
        } catch (e) {
            failures.push(e.name === 'TimeoutError'
                ? `${source.name} 响应超时`
                : `${source.name} 请求失败：${e.message}`);
        }
    }

    if (!usedSource) {
        /* 这段文案会直接显示在公开主页上，限流是常态，不要甩状态码给访客 */
        return rateLimited
            ? json({ error: '证书日志查询过于频繁，请稍后再试' }, 429)
            : json({ error: '证书日志暂时不可用，请稍后再试' }, 502);
    }

    /* 统一清洗：去掉 *. 通配符前缀、只保留本域下的合法主机名 */
    const names = new Set();
    for (const raw of rawNames) {
        const name = String(raw).trim().toLowerCase().replace(/^\*\./, '');
        if (!name || name === domain) continue;
        if (!name.endsWith('.' + domain)) continue;
        if (!/^[a-z0-9.-]+$/.test(name)) continue;
        names.add(name);
    }

    const subdomains = [...names].sort().slice(0, MAX_SUBDOMAINS);
    const body = {
        domain,
        subdomains,
        total: names.size,
        truncated: names.size > subdomains.length,
        source: usedSource,
        fetchedAt: new Date().toISOString()
    };

    const response = json(body);
    response.headers.set('Cache-Control', `public, max-age=${SUBDOMAIN_CACHE_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

/** 读 links.json（走 ASSETS，不额外发外部请求），收集其中出现过的一级域名 */
async function knownRootDomains(request, env) {
    const roots = new Set();
    try {
        const resp = await env.ASSETS.fetch(new Request(new URL('/links.json', request.url)));
        if (!resp.ok) return roots;
        const data = await resp.json();
        for (const link of data.links || []) {
            try {
                roots.add(rootDomainOf(new URL(link.url).hostname));
            } catch { /* 跳过非法 URL */ }
        }
    } catch { /* 读不到就返回空集合，等于全部拒绝 */ }
    return roots;
}

/* ==================== /api/login ==================== */

async function handleLogin(request, env) {
    if (!env.ADMIN_AUTH_HASH) {
        return json({ error: '服务端未配置 ADMIN_AUTH_HASH' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: '请求体不是合法 JSON' }, 400);
    }

    if (!(await authOk(env, body && body.auth))) {
        return json({ ok: false, error: '密码错误' }, 401);
    }
    return json({ ok: true });
}

/* ==================== /api/deploy ==================== */

async function handleDeploy(request, env) {
    if (!env.GITHUB_TOKEN || !env.ADMIN_AUTH_HASH) {
        return json({ error: '服务端未配置 GITHUB_TOKEN / ADMIN_AUTH_HASH' }, 500);
    }

    const auth = request.headers.get('X-Admin-Auth') || '';
    if (!auth) return json({ error: '缺少鉴权头' }, 401);
    if (!(await authOk(env, auth))) return json({ error: '鉴权失败' }, 401);

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

    // 取当前文件 SHA
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

    // 提交
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

/* ==================== 入口 ==================== */

export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);

        /* 公开只读接口，主页用它展示域名拓扑 */
        if (pathname === '/api/subdomains') {
            if (request.method !== 'GET') {
                return json({ error: 'Method Not Allowed' }, 405);
            }
            return handleSubdomains(request, env, ctx);
        }

        if (pathname === '/api/login' || pathname === '/api/deploy') {
            if (request.method !== 'POST') {
                return json({ error: 'Method Not Allowed' }, 405);
            }
            return pathname === '/api/login'
                ? handleLogin(request, env)
                : handleDeploy(request, env);
        }

        /* 其余路径交回静态资源；命中不到就是 404（与改造前行为一致） */
        return env.ASSETS.fetch(request);
    }
};
