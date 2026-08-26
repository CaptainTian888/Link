/**
 * Captain Link — 主页逻辑
 *
 * 渲染：按可注册域名分组（多子域才开组，其余进「独立站点」）。
 * 预览：按 links.json 的 preview 字段三选一 —— iframe / 截图 / 品牌卡。
 * 加载：IntersectionObserver 按需注入 iframe，进视口前 200px 才开始加载。
 */

(function() {
  'use strict';

  const D = window.LinkDomain;

  /* iframe 用固定的桌面虚拟视口渲染再等比缩放，
     这样无论卡片多宽，拿到的都是桌面版缩略图而不是手机版布局 */
  const VIEWPORT_W = 1280;
  const VIEWPORT_H = 800;

  let allLinks = [];
  let currentView = 'card';
  const collapsed = new Set();

  const grid = document.getElementById('linksGrid');
  const jumpBar = document.getElementById('jumpBar');
  const searchInput = document.getElementById('searchInput');
  const toggleBtns = document.querySelectorAll('.toggle-btn');

  /* ==================== 滚动防护 ==================== */
  /*
   * 「没操作也会自己上下滚」的根源：预览里的站点会调用 focus()（自动聚焦搜索框、
   * 登录框等）。焦点一旦落进 iframe，浏览器为了把焦点元素露出来就会滚动外层页面。
   * inert 和 tabindex="-1" 只能挡住 Tab 键顺序聚焦，挡不住跨文档的程序化聚焦 ——
   * 实测 document.activeElement 确实变成了预览 iframe。
   *
   * 这里的做法是：记一份滚动位置的短历史 + 最后一次用户手势的时间；
   * 一旦发现焦点跑进预览，就立刻夺回焦点，并把页面滚回被拽走之前的位置。
   * 只在「近期没有用户手势」时才回滚，所以不会和正常的滚轮操作打架。
   */
  const GESTURE_WINDOW_MS = 500;   /* 手势之后这段时间内的滚动都算用户驱动 */
  const BOOT_GRACE_MS = 1500;      /* 刚加载时浏览器可能恢复上次的滚动位置，别拦 */

  let lastGestureAt = 0;
  let allowUntil = 0;              /* 自家的程序化滚动（分组跳转）放行到这个时刻 */
  let lastGoodY = 0;
  let restoring = false;
  const bootAt = performance.now();

  /* 注意：跨文档的焦点转移不会在父页面派发 focusin（实测确实收不到），
     所以不能靠焦点事件来兜，只能直接看滚动本身。 */
  ['wheel', 'touchstart', 'touchmove', 'keydown', 'mousedown', 'pointerdown'].forEach(function(type) {
    addEventListener(type, function() { lastGestureAt = performance.now(); }, { passive: true, capture: true });
  });

  /* 浏览器的「页内查找」会滚动页面但不给页面发任何输入事件，只会改动选区。
     把选区变化也算成用户意图，Ctrl+F 才不会被下面的防护拉回去。 */
  document.addEventListener('selectionchange', function() {
    lastGestureAt = performance.now();
  }, { passive: true });

  /** 放行一次自家发起的滚动 */
  function allowProgrammaticScroll(ms) {
    allowUntil = performance.now() + (ms || 1200);
  }

  /* 焦点被预览抢走后如果不夺回来，方向键 / 空格 / PageDown 都会打进 iframe，
     外层页面就滚不动了。收不到 focusin，只能定期查一眼 activeElement。 */
  function releaseStolenFocus() {
    const active = document.activeElement;
    if (active && active.tagName === 'IFRAME' && active.closest('.link-preview')) {
      if (typeof active.blur === 'function') active.blur();
    }
  }

  setInterval(releaseStolenFocus, 500);

  addEventListener('scroll', function() {
    if (restoring) return;

    const now = performance.now();
    const y = window.scrollY;

    const userDriven = now - lastGestureAt < GESTURE_WINDOW_MS;
    const ourOwn = now < allowUntil;
    const booting = now - bootAt < BOOT_GRACE_MS;

    /* 这里刻意不拿 document.hasFocus() 当豁免条件：窗口失焦时它是 false，
       而「切走再切回来发现页面自己滚了一大段」恰恰是要治的症状 —— 豁免掉
       等于在最需要防护的时候把防护关了。查找栏由上面的 selectionchange 覆盖。 */
    if (userDriven || ourOwn || booting) {
      lastGoodY = y;
      return;
    }

    /* 走到这里 = 没有任何用户操作，页面却自己动了。
       元凶是预览里的站点调用 focus()，浏览器为了露出焦点元素滚动了外层页面。
       把焦点夺回来，并滚回原位。 */
    const active = document.activeElement;
    if (active && active.tagName === 'IFRAME' && active.closest('.link-preview')) {
      if (typeof active.blur === 'function') active.blur();
    }

    if (Math.abs(y - lastGoodY) > 1) {
      restoring = true;
      window.scrollTo({ top: lastGoodY, behavior: 'auto' });
      requestAnimationFrame(function() { restoring = false; });
    }
  }, { passive: true });

  /* ==================== 懒加载观察器 ==================== */

  const lazyObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      lazyObserver.unobserve(entry.target);
      injectIframe(entry.target);
    });
  }, { rootMargin: '200px 0px' });

  /* 卡片宽度变化时重算缩放比例，保证缩略图不变形 */
  const sizeObserver = new ResizeObserver(function(entries) {
    entries.forEach(function(entry) {
      applyScale(entry.target);
    });
  });

  function applyScale(box) {
    const w = box.clientWidth;
    if (w) box.style.setProperty('--preview-scale', w / VIEWPORT_W);
  }

  /**
   * 注入 iframe。三处细节都是为了不让预览影响外层页面：
   *   - tabindex=-1 + inert：键盘焦点进不去，避免 Tab 时视口被拽走
   *   - pointer-events 由 CSS 关掉：滚轮和点击全部穿透到卡片
   *   - scrolling=no：iframe 内部不出第二条滚动条
   */
  function injectIframe(box) {
    const src = box.getAttribute('data-src');
    if (!src) return;
    box.removeAttribute('data-src');

    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.width = VIEWPORT_W;
    iframe.height = VIEWPORT_H;
    iframe.loading = 'lazy';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.title = '';

    iframe.addEventListener('load', function() {
      box.classList.add('is-loaded');
    });

    box.appendChild(iframe);
  }

  /* ==================== 预览区渲染 ==================== */

  /* 同源链接绝不能用 iframe：本站自己也在链接列表里，嵌进来就是页面套页面，
     嵌套副本会再跑一遍 main.js、再拉一批 iframe，还会把滚动和焦点搅乱。
     这类链接一律走截图。 */
  function isSameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  function buildPreview(link) {
    let mode = link.preview || 'frame';
    const host = D.hostOf(link.url);

    if (mode === 'frame' && isSameOrigin(link.url)) mode = 'shot';

    if (mode === 'shot') {
      const shot = CONFIG.previewService + link.url;
      return `
        <div class="link-preview is-shot is-loaded" inert>
          <img class="preview-shot" src="${escapeAttr(shot)}" alt="" loading="lazy" decoding="async"
               onerror="this.closest('.link-preview').classList.add('shot-failed')">
          ${brandFace(link, host)}
        </div>`;
    }

    if (mode === 'offline') {
      return `
        <div class="link-preview is-brand is-loaded" inert>
          ${brandFace(link, host)}
          <span class="preview-badge">离线</span>
        </div>`;
    }

    return `
      <div class="link-preview is-frame" data-src="${escapeAttr(link.url)}" inert>
        <div class="skeleton"></div>
      </div>`;
  }

  /* 截图加载失败时露出的底衬，也是 offline 卡的主体 */
  function brandFace(link, host) {
    const initials = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
    const hue = hashHue(host);
    return `
      <div class="brand-face" style="--brand-hue:${hue}">
        <span class="brand-initials">${escapeHtml(initials)}</span>
        <span class="brand-host">${escapeHtml(host)}</span>
      </div>`;
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  /* ==================== 卡片 ==================== */

  function buildCard(link, sublabel) {
    const host = D.hostOf(link.url);
    const favicon = CONFIG.faviconService + encodeURIComponent(host) + '&sz=64';
    const label = sublabel && sublabel !== '@' ? sublabel : '';

    return `
      <a href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer" class="link-card">
        <div class="card-header">
          <img src="${escapeAttr(favicon)}" alt="" class="card-favicon"
               onerror="this.style.visibility='hidden'" loading="lazy" decoding="async">
          <span class="card-domain">${escapeHtml(link.title)}</span>
          ${label ? `<span class="card-sub">${escapeHtml(label)}</span>` : ''}
        </div>
        ${buildPreview(link)}
        <div class="card-body">
          <p class="card-desc">${escapeHtml(link.description || host)}</p>
        </div>
        <div class="card-footer">
          <span class="card-url">${escapeHtml(host)}</span>
          <span class="card-visit">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 9.5L9.5 2.5M9.5 2.5H5.5M9.5 2.5V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            访问
          </span>
        </div>
      </a>`;
  }

  function buildListItem(link, sublabel) {
    const host = D.hostOf(link.url);
    const favicon = CONFIG.faviconService + encodeURIComponent(host) + '&sz=64';
    const label = sublabel && sublabel !== '@' ? sublabel : '';
    return `
      <a href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer" class="list-link-item">
        <img src="${escapeAttr(favicon)}" alt="" class="list-favicon"
             onerror="this.style.visibility='hidden'" loading="lazy" decoding="async">
        <div class="list-info">
          <div class="list-title">${escapeHtml(link.title)}${label ? `<span class="list-sub">${escapeHtml(label)}</span>` : ''}</div>
          <div class="list-url">${escapeHtml(host)}</div>
        </div>
        <span class="list-arrow"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 17l9.2-9.2M17 17V7H7"/></svg></span>
      </a>`;
  }

  /* ==================== 分组区块 ==================== */

  function buildSection(id, title, links, sublabelOf) {
    const isCollapsed = collapsed.has(id);
    const items = links.map(l => currentView === 'list'
      ? buildListItem(l, sublabelOf ? sublabelOf(l) : '')
      : buildCard(l, sublabelOf ? sublabelOf(l) : '')).join('');

    const favicon = id === 'singles'
      ? ''
      : `<img src="${escapeAttr(CONFIG.faviconService + encodeURIComponent(id) + '&sz=64')}"
              alt="" class="group-favicon" onerror="this.style.visibility='hidden'" loading="lazy">`;

    return `
      <section class="link-group${isCollapsed ? ' is-collapsed' : ''}" id="group-${escapeAttr(id)}">
        <button class="group-header" type="button" data-group="${escapeAttr(id)}"
                aria-expanded="${isCollapsed ? 'false' : 'true'}">
          ${favicon}
          <span class="group-name">${escapeHtml(title)}</span>
          <span class="group-count">${links.length}</span>
          <svg class="group-chevron" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="group-body ${currentView === 'list' ? 'links-list-view' : 'links-grid'}">${items}</div>
      </section>`;
  }

  /* ==================== 主渲染 ==================== */

  function render(links, isSearch) {
    if (!links || links.length === 0) { renderEmpty(isSearch); return; }

    /* 搜索时不分组，直接平铺结果，避免结果散落在多个折叠区里 */
    if (isSearch) {
      jumpBar.innerHTML = '';
      jumpBar.hidden = true;
      grid.innerHTML = `
        <section class="link-group">
          <div class="group-header is-static">
            <span class="group-name">搜索结果</span>
            <span class="group-count">${links.length}</span>
          </div>
          <div class="group-body ${currentView === 'list' ? 'links-list-view' : 'links-grid'}">
            ${links.map(l => currentView === 'list' ? buildListItem(l, '') : buildCard(l, '')).join('')}
          </div>
        </section>`;
      afterRender();
      return;
    }

    const { groups, singles } = D.groupLinks(links);

    const sections = groups.map(g =>
      buildSection(g.domain, g.domain, g.links, l => D.subLabelOf(l.url, g.domain))
    );
    if (singles.length) {
      sections.push(buildSection('singles', '独立站点', singles, null));
    }

    grid.innerHTML = sections.join('');
    renderJumpBar(groups, singles.length);
    afterRender();
  }

  function renderJumpBar(groups, singleCount) {
    const chips = groups.map(g =>
      `<button class="jump-chip" type="button" data-target="group-${escapeAttr(g.domain)}">
         ${escapeHtml(g.domain)}<span>${g.links.length}</span>
       </button>`
    );
    if (singleCount) {
      chips.push(`<button class="jump-chip" type="button" data-target="group-singles">独立站点<span>${singleCount}</span></button>`);
    }
    jumpBar.innerHTML = chips.join('');
    jumpBar.hidden = chips.length === 0;
  }

  /* 渲染完成后统一挂观察器：先算缩放，再排队等进视口 */
  function afterRender() {
    grid.querySelectorAll('.link-preview').forEach(applyScale);
    grid.querySelectorAll('.link-preview.is-frame[data-src]').forEach(function(box) {
      sizeObserver.observe(box);
      lazyObserver.observe(box);
    });
  }

  /* ==================== 交互 ==================== */

  /* 分组折叠 —— 事件委托，重渲染后不用重新绑定 */
  grid.addEventListener('click', function(e) {
    const header = e.target.closest('.group-header[data-group]');
    if (!header) return;
    const id = header.dataset.group;
    const section = header.closest('.link-group');
    const isNowCollapsed = !section.classList.contains('is-collapsed');
    section.classList.toggle('is-collapsed', isNowCollapsed);
    header.setAttribute('aria-expanded', String(!isNowCollapsed));
    isNowCollapsed ? collapsed.add(id) : collapsed.delete(id);
  });

  jumpBar.addEventListener('click', function(e) {
    const chip = e.target.closest('.jump-chip');
    if (!chip) return;
    const target = document.getElementById(chip.dataset.target);
    if (!target) return;
    target.classList.remove('is-collapsed');
    collapsed.delete(chip.dataset.target.replace(/^group-/, ''));
    /* 这是我们自己发起的滚动，先给滚动防护放行，免得被当成异常滚动拉回去 */
    allowProgrammaticScroll(1500);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  toggleBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (currentView === this.dataset.view) return;
      toggleBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentView = this.dataset.view;
      rerender();
    });
  });

  function rerender() {
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    render(keyword ? filterLinks(keyword) : allLinks, !!keyword);
  }

  function filterLinks(keyword) {
    return allLinks.filter(link =>
      (link.title || '').toLowerCase().includes(keyword) ||
      (link.description || '').toLowerCase().includes(keyword) ||
      (link.url || '').toLowerCase().includes(keyword) ||
      (link.category || '').toLowerCase().includes(keyword)
    );
  }

  /* ==================== 统计 ==================== */

  function renderStats(links) {
    const { groups, singles } = D.groupLinks(links);
    const domains = groups.length + singles.length;
    animateCounter('statTotal', links.length);
    animateCounter('statFirst', domains);
    animateCounter('statSecond', links.length - domains);
  }

  function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 700, startTime = performance.now();
    function update(now) {
      const p = Math.min((now - startTime) / duration, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) return requestAnimationFrame(update);
      el.textContent = target;
    }
    requestAnimationFrame(update);
  }

  /* ==================== 工具 ==================== */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function renderEmpty(isSearch) {
    jumpBar.hidden = true;
    grid.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        <h3>${isSearch ? '没有匹配的链接' : '暂无链接'}</h3>
        <p>${isSearch ? '换个关键词试试' : '点击右上角「管理」进入后台添加你的第一个链接'}</p>
      </div>`;
  }

  /* ==================== 启动 ==================== */

  async function init() {
    try {
      const res = await fetch('links.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load links.json');
      const data = await res.json();
      allLinks = data.links || [];
      renderStats(allLinks);
      render(allLinks, false);
    } catch (err) {
      console.error('加载链接失败:', err);
      renderEmpty(false);
    }
  }

  if (searchInput) searchInput.addEventListener('input', rerender);
  document.addEventListener('DOMContentLoaded', init);
})();
