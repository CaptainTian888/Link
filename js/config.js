/**
 * Captain Link - 网站配置文件
 * ============================================================
 * 首次使用前，请修改下方 GITHUB_CONFIG 中的信息为你自己的仓库信息。
 * 修改后推送到 GitHub 即可生效。
 */

const CONFIG = {
  /* ==================== 网站基本信息 ==================== */
  siteName: 'Captain Link',
  siteTagline: '个人链接收纳站',
  siteDescription: '一站式管理 & 展示你的所有链接',
  faviconUrl: 'https://imagehub.tianzeqi.dev/file/favicon/1766540939004_14.png',

  /* ==================== GitHub 仓库配置 ==================== */
  /* 用于管理后台通过 GitHub API 自动更新 links.json 并触发重新部署   */
  /* 请替换为你的 GitHub 用户名和仓库名                              */
  GITHUB_CONFIG: {
    owner: 'CaptainTian888',          // GitHub 用户名
    repo:  'Link',                    // 仓库名
    branch: 'main',                   // ← 替换为你的分支名（通常为 main）
    filePath: 'links.json',           // 链接数据文件路径（一般不需要改）
    commitMessage: 'Auto-update links via Captain Link Admin',
  },

  /* ==================== 管理密码 ==================== */
  adminPassword: 'Shinevista888@',

  /* ==================== 预览截图服务 ==================== */
  /* 使用 thum.io 免费服务获取网站截图                              */
  /* 格式: 前缀 + 目标URL                                          */
  // 400px 宽度即可填满卡片（~340px × retina），体积减半、渲染更快
  previewService: 'https://image.thum.io/get/width/400/crop/500/noanimate/',
  // 首屏直出数量：这些卡片不走懒加载，直接出图
  eagerCount: 6,
  faviconService: 'https://www.google.com/s2/favicons?domain=',

  /* ==================== 部署等待时间（毫秒） ==================== */
  /* 保存后等待 CloudFlare / GitHub Pages 重新部署的时间            */
  deployWaitTime: 10000,
};
