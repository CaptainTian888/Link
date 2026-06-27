# Captain Link

个人链接收纳展示站 — 一站式管理 & 展示你的所有链接，支持 GitHub 托管 + CloudFlare 自动部署。

## 功能特性

- **链接展示** — 每个链接卡片自动生成网站截图预览，一目了然
- **后台管理** — 密码保护的管理后台，支持链接的增删改查
- **自动部署** — 在后台编辑链接后，一键提交到 GitHub，CloudFlare 自动重新部署
- **搜索过滤** — 主页支持按标题、描述、URL、分类实时搜索
- **响应式设计** — 完美适配桌面、平板、手机
- **暗色主题** — 玻璃拟态卡片 + 动画渐变背景，现代视觉体验

## 文件结构

```
captain-link/
├── index.html          # 主展示页
├── admin.html          # 管理后台页
├── links.json          # 链接数据（由后台自动更新）
├── .nojekyll           # 禁用 GitHub Pages Jekyll 处理
├── css/
│   └── style.css       # 全部样式
└── js/
    ├── config.js       # 网站配置（需修改）
    ├── main.js         # 主页逻辑
    └── admin.js        # 后台逻辑
```

## 快速开始

### 第一步：创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)，点击 **New repository**
2. 仓库名填写 `captain-link`（或任意名称），设为 **Public**
3. 将本项目所有文件上传到仓库（可通过 `git push` 或网页上传）

### 第二步：修改配置

打开 `js/config.js`，修改以下内容：

```javascript
GITHUB_CONFIG: {
  owner: '你的GitHub用户名',   // ← 改成你的
  repo:  'captain-link',       // ← 改成你的仓库名
  branch: 'main',              // ← 改成你的分支名
  filePath: 'links.json',
  commitMessage: 'Auto-update links via Captain Link Admin',
},
```

提交修改到 GitHub。

### 第三步：部署到 CloudFlare Pages

1. 登录 [CloudFlare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 选择你刚创建的 GitHub 仓库
4. 构建配置：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `/`（根目录）
   - **Root directory**: 留空
5. 点击 **Save and Deploy**
6. 等待部署完成，CloudFlare 会给你一个 `xxx.pages.dev` 的域名

> 之后每次推送代码到 GitHub，CloudFlare 都会自动重新部署。

### 第四步（可选）：绑定自定义域名

在 CloudFlare Pages 项目设置 → **Custom domains** 中添加你的域名。

## 使用管理后台

### 进入后台

1. 打开网站首页，点击右上角 **「管理」** 按钮
2. 输入管理密码（在 `js/config.js` 中配置）
3. 进入管理面板

### 配置 GitHub Token（首次使用）

管理后台需要 GitHub Personal Access Token 来自动提交链接变更：

1. 访问 [GitHub Token 设置页](https://github.com/settings/tokens)
2. 点击 **Generate new token (classic)**
3. 勾选 `repo` 权限（完整仓库读写）
4. 生成并复制 Token（格式形如 `ghp_xxxxxxxx...`）
5. 在管理后台的「GitHub 部署设置」区域粘贴 Token，点击「保存 Token」

> Token 存储在浏览器 `localStorage` 中，一次保存后自动生效，关闭浏览器不会丢失。

### 添加/编辑/删除链接

1. 在「添加新链接」表单中填写：标题、URL、描述、分类
2. 点击「添加/保存」
3. 已有链接可通过「编辑」和「删除」按钮操作
4. 所有修改先保存在内存中，**需要点击底部「保存并自动部署」才会生效**

### 保存并自动部署

1. 确认所有链接修改无误
2. 点击底部 **「保存并自动部署」** 按钮
3. 系统会自动：
   - 通过 GitHub API 提交新的 `links.json` 到仓库
   - 等待 CloudFlare 检测到更新并重新部署（约 10 秒）
   - 自动跳转回首页，展示更新后的链接

## 安全说明

- 管理密码存储在前端 `config.js` 中，理论上可通过查看源码获取。这是一个**静态网站**的固有限制，适合个人使用。如需更高安全性，建议搭配 CloudFlare Access 使用。
- GitHub Token 存储在浏览器 `localStorage` 中，持久化保存。
- 建议将 `admin.html` 加入 `robots.txt` 避免搜索引擎收录。

## 自定义

### 修改网站名称

编辑 `js/config.js` 中的 `siteName`、`siteTagline`、`siteDescription`。

### 修改管理密码

编辑 `js/config.js` 中的 `adminPassword`。

### 修改主题颜色

编辑 `css/style.css` 顶部的 CSS 变量：

```css
:root {
  --accent: #00d4ff;          /* 主强调色 */
  --accent-2: #0099cc;        /* 次强调色 */
  --bg-base: #0a1628;         /* 背景色 */
  /* ... */
}
```

### 修改 Favicon

编辑 `index.html` 和 `admin.html` 中的 `<link rel="icon">` 标签，以及 `js/config.js` 中的 `faviconUrl`。

## 技术栈

- 纯 HTML / CSS / JavaScript（无构建工具、无框架）
- [thum.io](https://thum.io) — 网站截图预览服务
- [Google Favicons API](https://www.google.com/s2/favicons) — 网站图标
- GitHub Contents API — 文件更新
- CloudFlare Pages — 静态托管

## License

MIT
