/**
 * Captain Link — 域名归类
 *
 * 首页与后台共用：把链接按「可注册域名」（eTLD+1）聚成组。
 * 挂在 window.LinkDomain 下，两边都是普通 <script>，不用模块系统。
 */

(function() {
  'use strict';

  /* 常见多段后缀。当前数据全是单段后缀（.dev / .ai / .group / .trade …），
     这份清单只为将来加 example.com.cn 这类域名时不至于误判成 com.cn */
  const MULTI_PART_SUFFIX = [
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.hk', 'com.tw', 'com.au', 'co.jp', 'co.kr', 'com.br', 'com.sg'
  ];

  /** 从 hostname 取可注册域名：blog.tianzeqi.dev → tianzeqi.dev */
  function registrableDomain(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host) return '';

    const parts = host.split('.');
    if (parts.length <= 2) return host;

    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIX.includes(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return lastTwo;
  }

  /** 从完整 URL 取可注册域名；URL 非法时回退为原串 */
  function domainOf(url) {
    try {
      return registrableDomain(new URL(url).hostname);
    } catch {
      return String(url || '');
    }
  }

  /** 展示用主机名：https://blog.tianzeqi.dev/x → blog.tianzeqi.dev */
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return String(url || '');
    }
  }

  /**
   * 取子域名前缀，用于组内展示：
   *   blog.tianzeqi.dev（组 tianzeqi.dev） → 'blog'
   *   tianzeqi.dev     （组 tianzeqi.dev） → '@'   ← 主域名本身
   */
  function subLabelOf(url, groupDomain) {
    const host = hostOf(url);
    if (host === groupDomain) return '@';
    return host.endsWith('.' + groupDomain)
      ? host.slice(0, -(groupDomain.length + 1))
      : host;
  }

  /**
   * 分组。只有拥有 2 个及以上链接的域名才单独成组，
   * 其余全部并进 singles，由调用方渲染成「独立站点」网格。
   *
   * @returns {{groups: Array<{domain: string, links: Array}>, singles: Array}}
   */
  function groupLinks(links) {
    const byDomain = new Map();

    (links || []).forEach(link => {
      const domain = domainOf(link.url);
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(link);
    });

    const groups = [];
    const singles = [];

    byDomain.forEach((items, domain) => {
      if (items.length >= 2) {
        /* 组内排序：主域名排最前，其余按子域名字母序 */
        items.sort((a, b) => {
          const sa = subLabelOf(a.url, domain);
          const sb = subLabelOf(b.url, domain);
          if (sa === '@') return -1;
          if (sb === '@') return 1;
          return sa.localeCompare(sb);
        });
        groups.push({ domain, links: items });
      } else {
        singles.push(items[0]);
      }
    });

    /* 组按链接数降序，同数量按域名字母序 */
    groups.sort((a, b) => b.links.length - a.links.length || a.domain.localeCompare(b.domain));
    singles.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    return { groups, singles };
  }

  window.LinkDomain = { registrableDomain, domainOf, hostOf, subLabelOf, groupLinks };
})();
