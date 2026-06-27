/**
 * Captain Link — 主页逻辑
 * 预览方式：iframe 嵌入真实网页 → 失败则回退 thum.io 截图 → 最终回退 favicon
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
      startIframeLoaders();
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
      startIframeLoaders();
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

  /* ==================== 卡片视图（iframe 小窗预览） ==================== */
  function renderCardView(links) {
    if (!links || links.length === 0) { renderEmpty(); return; }
    grid.className = 'links-grid';

    grid.innerHTML = links.map((link, index) => {
      const faviconUrl = CONFIG.faviconService + encodeURIComponent(getDomain(link.url)) + '&sz=64';
      const fallbackSrc = CONFIG.previewService + encodeURIComponent(link.url);
      const isEager = index < eagerCount;
      const delay = (index * 0.05).toFixed(2);

      // 首屏 iframe 直出；其余挂 data-src 懒加载
      const iframeSrc = isEager
        ? `src="${escapeAttr(link.url)}"`
        : `data-src="${escapeAttr(link.url)}"`;

      return `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"
           class="link-card" style="animation-delay: ${delay}s" data-fallback="${escapeAttr(fallbackSrc)}">
          <div class="link-preview">
            <div class="preview-frame">
              <div class="skeleton"></div>
              <iframe ${iframeSrc}
                      sandbox="allow-scripts allow-same-origin allow-forms"
                      loading="${isEager ? 'eager' : 'lazy'}"
                      class="${isEager ? 'preview-eager' : 'lazy-iframe'}"
                      referrerpolicy="no-referrer"
                      title="${escapeAttr(link.title)}"></iframe>
              <div class="preview-overlay"></div>
            </div>
            <div class="preview-fallback">
              <img src="${escapeAttr(faviconUrl)}" alt="" loading="lazy" decoding="async">
              <span>${escapeHtml(getDomain(link.url))}</span>
            </div>
          </div>
          <div class="link-info">
            <div class="link-header">
              <img src="${escapeAttr(faviconUrl)}" alt="" class="link-favicon"
                   onerror="this.style.display='none'" loading="lazy" decoding="async">
              <span class="link-title">${escapeHtml(link.title)}</span>
            </div>
            <p class="link-description">${escapeHtml(link.description || '')}</p>
            <div class="link-meta">
              <span class="link-url">${escapeHtml(getDomain(link.url))}</span>
              ${link.category ? `<span class="link-category">${escapeHtml(link.category)}</span>` : ''}
            </div>
          </div>
        </a>
      `;
    }).join('');
  }

  /* ==================== iframe 加载器 ==================== */
  function startIframeLoaders() {
    loadEagerIframes();
    observeLazyIframes();
  }

  /* 首屏 iframe 直接加载 + 超时回退 */
  function loadEagerIframes() {
    grid.querySelectorAll('iframe.preview-eager').forEach(setupIframeTimeout);
  }

  function setupIframeTimeout(iframe) {
    const card = iframe.closest('.link-card');
    const fallbackSrc = card ? card.dataset.fallback : '';
    let resolved = false;

    const resolvePreview = function(success) {
      if (resolved) return;
      resolved = true;

      const skeleton = iframe.parentElement.querySelector('.skeleton');
      if (skeleton) skeleton.style.display = 'none';

      if (success) {
        iframe.style.display = 'block';
      } else {
        // iframe 加载失败 → 用 thum.io 截图回退
        iframe.style.display = 'none';
        if (fallbackSrc) {
          showImageFallback(iframe.parentElement, fallbackSrc);
        } else {
          showFaviconFallback(card);
        }
      }
    };

    iframe.addEventListener('load', function() {
      // load 事件触发 = iframe 成功加载（未被 X-Frame-Options 阻止）
      resolvePreview(true);
    });

    // 超时 3 秒未加载完成 → 视为失败
    setTimeout(function() {
      if (!resolved) {
        // 检查 iframe 是否有内容（跨域无法访问 contentDocument，用 try-catch）
        try {
          const doc = iframe.contentDocument;
          if (doc && doc.body && doc.body.innerHTML.trim()) {
            resolvePreview(true);
            return;
          }
        } catch (e) {
          // 跨域，无法判断，假设成功
          resolvePreview(true);
          return;
        }
        resolvePreview(false);
      }
    }, 3000);
  }

  /* 懒加载：IntersectionObserver + 进入视口后再加载 iframe */
  function observeLazyIframes() {
    if (!window.IntersectionObserver) return;

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        const iframe = entry.target;
        const src = iframe.getAttribute('data-src');
        if (!src) return;

        iframe.src = src;
        iframe.removeAttribute('data-src');
        setupIframeTimeout(iframe);
        observer.unobserve(iframe);
      });
    }, { rootMargin: '600px', threshold: 0.01 });

    grid.querySelectorAll('iframe.lazy-iframe').forEach(function(iframe) {
      observer.observe(iframe);
    });
  }

  /* 截图回退：用 <img> 替换 iframe */
  function showImageFallback(frame, src) {
    const img = document.createElement('img');
    img.src = src;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.cssText = 'display:block; width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0;';
    img.alt = '';

    img.onerror = function() {
      img.remove();
      // 截图也失败 → favicon
      const card = frame.closest('.link-card');
      if (card) showFaviconFallback(card);
    };

    frame.appendChild(img);
  }

  function showFaviconFallback(card) {
    if (!card) return;
    const fallback = card.querySelector('.preview-fallback');
    if (fallback) fallback.style.display = 'flex';
    const skeleton = card.querySelector('.skeleton');
    if (skeleton) skeleton.style.display = 'none';
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
    startIframeLoaders();
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
