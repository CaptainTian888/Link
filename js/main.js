/**
 * Captain Link — 主页逻辑
 * 负责：加载链接数据 → 渲染卡片 / 列表 → 首屏直出 + 懒加载 → 搜索过滤 → 视图切换
 */

(function() {
  'use strict';

  let allLinks = [];
  let currentView = 'card';
  const grid = document.getElementById('linksGrid');
  const searchInput = document.getElementById('searchInput');
  const toggleBtns = document.querySelectorAll('.toggle-btn');

  /* ==================== 初始化 ==================== */
  async function init() {
    try {
      const res = await fetch('links.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load links.json');
      const data = await res.json();
      allLinks = data.links || [];
      renderStats(allLinks);
      renderCardView(allLinks);
      observePreviews();
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
      observePreviews();
    });
  });

  function renderByView(links) {
    if (currentView === 'list') {
      renderListView(links);
    } else {
      renderCardView(links);
    }
  }

  /* ==================== 渲染域名统计 ==================== */
  function renderStats(links) {
    let firstLevel = 0;
    let secondLevel = 0;

    links.forEach(link => {
      try {
        const hostname = new URL(link.url).hostname;
        const parts = hostname.split('.');
        if (parts.length <= 2) {
          firstLevel++;
        } else {
          secondLevel++;
        }
      } catch {
        firstLevel++;
      }
    });

    animateCounter('statTotal', links.length);
    animateCounter('statFirst', firstLevel);
    animateCounter('statSecond', secondLevel);
  }

  function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = 0;
    const duration = 800;
    const startTime = performance.now();

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      el.textContent = current;
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = target;
        el.classList.add('counted');
        setTimeout(() => el.classList.remove('counted'), 500);
      }
    }
    requestAnimationFrame(update);
  }

  /* ==================== 卡片视图 ==================== */
  function renderCardView(links) {
    if (!links || links.length === 0) {
      renderEmpty();
      return;
    }

    grid.className = 'links-grid';
    const eagerCount = CONFIG.eagerCount || 6;

    grid.innerHTML = links.map((link, index) => {
      const faviconUrl = CONFIG.faviconService + getDomain(link.url) + '&sz=64';
      const previewSrc = CONFIG.previewService + encodeURIComponent(link.url);
      const delay = (index * 0.05).toFixed(2);

      // 首屏卡片：直接 src + fetchpriority=high + decoding=async，不设 skeleton
      const isEager = index < eagerCount;

      return `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"
           class="link-card" style="animation-delay: ${delay}s">
          <div class="link-preview">
            ${isEager ? '' : '<div class="skeleton"></div>'}
            <img ${isEager
              ? `src="${escapeAttr(previewSrc)}" loading="eager" fetchpriority="high"`
              : `data-src="${escapeAttr(previewSrc)}" loading="lazy"`
            }
                 decoding="async"
                 alt="${escapeAttr(link.title)}"
                 class="${isEager ? 'preview-eager' : 'lazy-preview'}"
                 onerror="handlePreviewError(this, '${escapeAttr(link.url)}')">
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

  /* ==================== 列表视图（按域名级别分组） ==================== */
  function renderListView(links) {
    if (!links || links.length === 0) {
      renderEmpty();
      return;
    }

    const firstLevel = [];
    const secondLevel = [];

    links.forEach(link => {
      try {
        const hostname = new URL(link.url).hostname;
        const parts = hostname.split('.');
        if (parts.length <= 2) {
          firstLevel.push(link);
        } else {
          secondLevel.push(link);
        }
      } catch {
        firstLevel.push(link);
      }
    });

    grid.className = 'links-list-view';
    grid.innerHTML = [
      buildListSection('一级域名', firstLevel),
      buildListSection('二级域名', secondLevel)
    ].join('');
  }

  function buildListSection(title, links) {
    if (links.length === 0) return '';

    const items = links.map((link, i) => {
      const faviconUrl = CONFIG.faviconService + getDomain(link.url) + '&sz=64';
      return `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"
           class="list-link-item" style="animation-delay: ${(i * 0.03).toFixed(2)}s">
          <img src="${escapeAttr(faviconUrl)}" alt="" class="list-favicon"
               onerror="this.style.display='none'" loading="lazy" decoding="async">
          <div class="list-info">
            <div class="list-title">${escapeHtml(link.title)}</div>
            <div class="list-url">${escapeHtml(getDomain(link.url))}</div>
          </div>
          <span class="list-arrow">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 17l9.2-9.2M17 17V7H7"/>
            </svg>
          </span>
        </a>
      `;
    }).join('');

    return `
      <div class="list-section">
        <h3>${escapeHtml(title)} <span class="section-count">${links.length}</span></h3>
        ${items}
      </div>
    `;
  }

  /* ==================== IntersectionObserver 懒加载（仅对非首屏卡片） ==================== */
  function observePreviews() {
    if (!window.IntersectionObserver) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.getAttribute('data-src');
        if (!src) return;

        img.src = src;
        img.classList.add('loaded');
        img.onload = function() {
          const skeleton = img.parentElement.querySelector('.skeleton');
          if (skeleton) skeleton.style.display = 'none';
          img.style.display = 'block';
        };

        observer.unobserve(img);
      });
    }, {
      rootMargin: '600px',  // 提前 600px 加载，确保滚动到之前已就绪
      threshold: 0.01
    });

    grid.querySelectorAll('img.lazy-preview').forEach(img => {
      observer.observe(img);
    });
  }

  /* ==================== 预览图加载失败回退 ==================== */
  window.handlePreviewError = function(img, url) {
    const parent = img.parentElement;
    if (!parent) return;
    const skeleton = parent.querySelector('.skeleton');
    if (skeleton) skeleton.style.display = 'none';
    img.style.display = 'none';
    const fallback = parent.querySelector('.preview-fallback');
    if (fallback) fallback.style.display = 'flex';
  };

  /* ==================== 空状态 ==================== */
  function renderEmpty() {
    grid.className = 'links-grid';
    grid.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
        </svg>
        <h3>暂无链接</h3>
        <p>点击右上角「管理」进入后台添加你的第一个链接</p>
      </div>
    `;
  }

  /* ==================== 搜索过滤 ==================== */
  function handleSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    const links = keyword ? filterLinks(keyword) : allLinks;
    renderByView(links);
    observePreviews();
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
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ==================== 启动 ==================== */
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
