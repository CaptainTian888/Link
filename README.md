# Captain Link

个人链接收纳展示站 — 一站式管理 & 展示你的所有链接。

## 功能特性

- **链接展示** — 每个链接卡片嵌入式网页小窗预览，点击直达
- **后台管理** — 密码保护的管理后台，支持链接的增删改查与排序
- **自动部署** — 后台编辑链接后，一键保存自动部署上线
- **搜索过滤** — 主页支持按标题、描述、URL、分类实时搜索
- **视图切换** — 卡片模式 / 列表模式一键切换，按域名分级展示
- **域名拓扑** — 后台登录后可展开任一一级域名，从证书透明度日志反查其子域名，标出已收录 / 未收录
- **响应式设计** — 完美适配桌面、平板、手机
- **暗色主题** — 玻璃拟态卡片 + 动画渐变背景

## 文件结构

```
├── index.html          # 主展示页
├── admin.html          # 管理后台页
├── links.json          # 链接数据
├── wrangler.jsonc      # Worker 配置（静态资源 + /api 路由）
├── .assetsignore       # 不对外提供的文件
├── css/
│   └── style.css       # 全部样式
├── worker/
│   └── index.js        # Worker：/api/login 校验密码、/api/deploy 写回 links.json、
│                       #         /api/subdomains 查子域名
└── js/
    ├── config.js       # 网站配置（不含任何凭证）
    ├── main.js         # 主页逻辑
    └── admin.js        # 后台逻辑
```

## 使用管理后台

1. 打开网站首页，点击右上角「管理」按钮
2. 输入管理密码进入后台
3. 在顶部表单添加新链接，或点击列表中的「编辑」弹窗修改
4. 使用 ↑↓ 箭头调整链接排列顺序
5. 点击底部「保存并自动部署」，系统自动提交并刷新上线

## 部署配置

本站部署为 **Cloudflare Worker + 静态资源**（`wrangler.jsonc`）：静态文件由 ASSETS 绑定直接服务，
只有 `/api/*` 进入 `worker/index.js`，**凭证只存在于服务端**。

在 Cloudflare Dashboard → **Workers & Pages** → `link` → **Settings** → **Variables and Secrets** 添加两个 **Secret**：

| 变量名 | 值 |
| --- | --- |
| `GITHUB_TOKEN` | GitHub fine-grained token，只授权本仓库、只给 **Contents: Read and write** |
| `ADMIN_AUTH_HASH` | 管理密码派生出的哈希，见下 |

获取 `ADMIN_AUTH_HASH`：打开 `admin.html`，F12 控制台执行

```js
await printAdminAuthHash('你要设置的管理密码')
```

复制打印出的 64 位十六进制字符串填入。改密码时重新执行一次、更新这个变量即可。

> 密码经 PBKDF2（20 万次迭代、salt `link-admin-auth-v1`）派生成 auth token，
> 服务端只保存它的 SHA-256 —— 既反推不出密码，环境变量泄漏也换不出可用的令牌。

Secret 保存后立即对运行中的 Worker 生效，不需要重新部署。

可选变量（不配则用 `worker/index.js` 里的默认值）：`GH_OWNER`、`GH_REPO`、`GH_BRANCH`、`GH_PATH`。

## 域名拓扑（`/api/subdomains`）

后台「域名拓扑」区块把 `links.json` 里的链接按一级域名归拢，展开某个域名时才请求
`GET /api/subdomains?domain=<一级域名>`，由 Worker 去查证书透明度日志。

- **双数据源**：先试 certSpotter，失败再试 crt.sh（crt.sh 经常 502），返回里的 `source` 标明实际来源
- **结果缓存 6 小时**：走 Cloudflare Cache API，失败结果不入缓存
- **需要管理员鉴权**：请求必须带 `X-Admin-Auth`，与 `/api/deploy` 同一套校验。拓扑只在后台展示，接口跟着一起锁，否则藏了 UI 而接口敞着等于没藏
- **域名白名单**：只接受 `links.json` 中已出现的一级域名，避免被当成任意域名的扫描代理
- 两个上游数据源本身都是免登录的公开 API，不需要额外凭证

> 证书透明度日志只反映**签发过证书**的名字：没申请过证书的子域名查不到，
> 已经下线但证书还在有效期内的会照样列出。它是参考，不是权威清单。

> ⚠️ **不要把 Token 或密码写进 `js/` 下的任何文件**（包括数组拆分、Base64、XOR 等混淆手法）。
> 静态站点的 JS 对所有访客可读，混淆只会绕过 GitHub 的密钥扫描告警，不会提高任何安全性。

## 自定义

编辑 `js/config.js` 可修改网站名称、图标、预览服务等配置。
编辑 `css/style.css` 顶部 CSS 变量可调整配色方案。

## 技术栈

- 纯 HTML / CSS / JavaScript（无构建工具、无框架）
- iframe 嵌入式网页小窗预览
- GitHub Contents API — 自动部署（经服务端代理调用）
- CloudFlare Workers — 静态资源托管 + `/api` 后台接口

## License

MIT
