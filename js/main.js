/**
 * Captain Link — 主页逻辑
 * 预览方案：纯 iframe 嵌入式小窗，无回退，加载中显示骨架屏
 */

(function() {
  'use strict';

  let allLinks = [];
  let currentView = 'card';
  const grid = document.getElementById('linksGrid');
  const searchInput = document.getElementById('searchInput');
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const eagerCount = CONFIG.eagerCount || 6;

  /* ==================== 初始化 ==================== */
  async function init() {
    try {
      const res = await fetch('links.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load links.json');
      const data = await res.json();
      allLinks = data.links || [];
      renderStats(allLinks);
      renderCardView(allLinks);
    } catch (err) {
      console.error('加载链接失败:', err);
      renderEmpty();
    }
  }

  /* ==================== 视图切换 ==================== */
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      if (currentView === this.dataset.view) return;
      toggleBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentView = this.dataset.view;
      const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const links = keyword ? filterLinks(keyword) : allLinks;
      renderByView(links);
    });
  });

  function renderByView(links) {
    if (currentView === 'list') {
      renderListView(links);
    } else {
      renderCardView(links);
    }
  }

  /* ==================== 域名统计 ==================== */
  function renderStats(links) {
    let firstLevel = 0, secondLevel = 0;
    links.forEach(link => {
      try {
        const parts = new URL(link.url).hostname.split('.');
        parts.length <= 2 ? firstLevel++ : secondLevel++;
      } catch { firstLevel++; }
    });
    animateCounter('statTotal', links.length);
    animateCounter('statFirst', firstLevel);
    animateCounter('statSecond', secondLevel);
  }

  function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 800, startTime = performance.now();
    function update(now) {
      const p = Math.min((now - startTime) / duration, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) return requestAnimationFrame(update);
      el.textContent = target;
    }
    requestAnimationFrame(update);
  }

  /* ==================== 卡片视图（iframe 嵌入式小窗，按域名分级） ==================== */
  function renderCardView(links) {
    if (!links || links.length === 0) { renderEmpty(); return; }

    const firstLevel = [], secondLevel = [];
    links.forEach(link => {
      try {
        new URL(link.url).hostname.split('.').length <= 2
          ? firstLevel.push(link) : secondLevel.push(link);
      } catch { firstLevel.push(link); }
    });

    grid.className = 'links-grid-categorized';
    grid.innerHTML = [
      buildCardSection('一级域名', firstLevel),
      buildCardSection('二级域名', secondLevel)
    ].filter(Boolean).join('');

    injectIframes();
  }

  function buildCardSection(title, links) {
    if (links.length === 0) return '';
    return `
      <div class="card-section">
        <h3 class="card-section-title">${escapeHtml(title)} <span class="section-count">${links.length}</span></h3>
        <div class="links-grid">
          ${links.map((link, index) => {
            const faviconUrl = CONFIG.faviconService + encodeURIComponent(getDomain(link.url)) + '&sz=64';
            const delay = (index * 0.04).toFixed(2);
            return `
              <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"
                 class="link-card" style="animation-delay: ${delay}s">
                <div class="card-header">
                  <img src="${escapeAttr(faviconUrl)}" alt="" class="card-favicon"
                       onerror="this.style.display='none'" loading="lazy" decoding="async">
                  <span class="card-domain">${escapeHtml(link.title)}</span>
                  ${link.category ? `<span class="card-tag">${escapeHtml(link.category)}</span>` : ''}
                </div>
                <div class="link-preview" data-src="${escapeAttr(link.url)}">
                  <div class="skeleton"></div>
                  <div class="preview-overlay"></div>
                </div>
                <div class="card-footer">
                  <span class="card-url">${escapeHtml(link.url)}</span>
                  <span class="card-visit">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 9.5L9.5 2.5M9.5 2.5H5.5M9.5 2.5V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    访问
                  </span>
                </div>
              </a>`;
          }).join('')}
        </div>
      </div>`;
  }

  /* ==================== iframe 注入策略 ==================== */
  function injectIframes() {
    const previews = grid.querySelectorAll('.link-preview[data-src]');
    const isLazySupported = 'loading' in HTMLIFrameElement.prototype;

    previews.forEach(function(el) {
      const src = el.getAttribute('data-src');
      if (!src) return;
      el.removeAttribute('data-src');

      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.sandbox = 'allow-scripts allow-same-origin';
      iframe.referrerPolicy = 'no-referrer';
      iframe.title = '';

      // 首屏 eager；其余 native lazy（无需 IntersectionObserver）
      const isEager = Array.from(previews).indexOf(el) < eagerCount;
      if (isLazySupported && !isEager) {
        iframe.loading = 'lazy';
      } else {
        iframe.loading = 'eager';
      }

      // 插入到 preview-overlay 之前
      const overlay = el.querySelector('.preview-overlay');
      if (overlay) {
        el.insertBefore(iframe, overlay);
      } else {
        el.appendChild(iframe);
      }

      // iframe 加载完成 → 隐藏骨架
      iframe.addEventListener('load', function() {
        const skeleton = el.querySelector('.skeleton');
        if (skeleton) skeleton.style.display = 'none';
        iframe.classList.add('loaded');
      });
    });
  }

  /* ==================== 列表视图 ==================== */
  function renderListView(links) {
    if (!links || links.length === 0) { renderEmpty(); return; }
    const firstLevel = [], secondLevel = [];
    links.forEach(link => {
      try {
        new URL(link.url).hostname.split('.').length <= 2
          ? firstLevel.push(link) : secondLevel.push(link);
      } catch { firstLevel.push(link); }
    });
    grid.className = 'links-list-view';
    grid.innerHTML = [buildListSection('一级域名', firstLevel), buildListSection('二级域名', secondLevel)].join('');
  }

  function buildListSection(title, links) {
    if (links.length === 0) return '';
    return `
      <div class="list-section">
        <h3>${escapeHtml(title)} <span class="section-count">${links.length}</span></h3>
        ${links.map((link, i) => {
          const faviconUrl = CONFIG.faviconService + encodeURIComponent(getDomain(link.url)) + '&sz=64';
          return `
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"
               class="list-link-item" style="animation-delay: ${(i * 0.03).toFixed(2)}s">
              <img src="${escapeAttr(faviconUrl)}" alt="" class="list-favicon" onerror="this.style.display='none'" loading="lazy" decoding="async">
              <div class="list-info">
                <div class="list-title">${escapeHtml(link.title)}</div>
                <div class="list-url">${escapeHtml(getDomain(link.url))}</div>
              </div>
              <span class="list-arrow"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 17l9.2-9.2M17 17V7H7"/></svg></span>
            </a>`;
        }).join('')}
      </div>`;
  }

  /* ==================== 搜索 ==================== */
  function handleSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    renderByView(keyword ? filterLinks(keyword) : allLinks);
  }

  function filterLinks(keyword) {
    return allLinks.filter(link =>
      (link.title || '').toLowerCase().includes(keyword) ||
      (link.description || '').toLowerCase().includes(keyword) ||
      (link.url || '').toLowerCase().includes(keyword) ||
      (link.category || '').toLowerCase().includes(keyword)
    );
  }

  /* ==================== 工具函数 ==================== */
  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); }
    catch { return url; }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ==================== 空状态 ==================== */
  function renderEmpty() {
    grid.className = 'links-grid';
    grid.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        <h3>暂无链接</h3>
        <p>点击右上角「管理」进入后台添加你的第一个链接</p>
      </div>`;
  }

  /* ==================== 启动 ==================== */
  if (searchInput) searchInput.addEventListener('input', handleSearch);
  document.addEventListener('DOMContentLoaded', init);
})();
