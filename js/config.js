const CONFIG = {
  siteName: 'Captain Link',
  siteTagline: '个人链接收纳站',
  siteDescription: '一站式管理 & 展示你的所有链接',
  faviconUrl: 'https://imagehub.tianzeqi.dev/file/favicon/1766540939004_14.png',

  // 后台接口（同源 Pages Function）。
  // GitHub Token 与管理密码都只存在于 Cloudflare 服务端环境变量，
  // 不要再往这个文件里写任何凭证 —— 它对所有访客可读。
  API: {
    login:  '/api/login',
    deploy: '/api/deploy',
  },

  previewService: 'https://image.thum.io/get/width/400/crop/500/noanimate/',
  eagerCount: 6,
  faviconService: 'https://www.google.com/s2/favicons?domain=',
  deployWaitTime: 10000,
};
