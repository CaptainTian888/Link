/**
 * Captain Link — 主页逻辑
 * 负责：加载链接数据 → 渲染卡片 → 预览截图 → 搜索过滤
 */

(function() {
  'use strict';

  let allLinks = [];
  const grid = document.getElementById('linksGrid');
  const searchInput = document.getElementById('searchInput');

  /* ==================== 初始化 ==================== */
  async function init() {
    try {
      const res = await fetch('links.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load links.json');
      const data = await res.json();
      allLinks = data.links || [];
      renderStats(allLinks);
      renderLinks(allLinks);
    } catch (err) {
      console.error('加载链接失败:', err);
      renderEmpty();
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
        // parts: e.g. ["example", "com"] = 一级域名 (2 parts)
        //        e.g. ["sub", "tianzeqi", "dev"] = 二级域名 (3 parts)
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
      // easeOutCubic
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

  /* ==================== 渲染链接卡片 ==================== */
  function renderLinks(links) {
    if (!links || links.length === 0) {
      renderEmpty();
      return;
    }

    grid.innerHTML = links.map((link, index) => {
      const previewUrl = CONFIG.previewService + encodeURIComponent(link.url);
      const faviconUrl = CONFIG.faviconService + getDomain(link.url) + '&sz=64';
      const delay = (index * 0.08).toFixed(2);

      return `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="link-card" style="animation-delay: ${delay}s">
          <div class="link-preview">
            <div class="skeleton"></div>
            <img src="${escapeAttr(previewUrl)}" alt="${escapeAttr(link.title)}" loading="lazy"
                 onload="this.previousElementSibling.style.display='none'; this.style.display='block';"
                 onerror="handlePreviewError(this, '${escapeAttr(link.url)}')"
                 style="display:none;">
            <div class="preview-fallback">
              <img src="${escapeAttr(faviconUrl)}" alt="">
              <span>${escapeHtml(getDomain(link.url))}</span>
            </div>
          </div>
          <div class="link-info">
            <div class="link-header">
              <img src="${escapeAttr(faviconUrl)}" alt="" class="link-favicon"
                   onerror="this.style.display='none'">
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

  /* ==================== 预览图加载失败回退 ==================== */
  window.handlePreviewError = function(img, url) {
    const skeleton = img.previousElementSibling;
    if (skeleton) skeleton.style.display = 'none';
    img.style.display = 'none';
    const fallback = img.parentElement.querySelector('.preview-fallback');
    if (fallback) fallback.style.display = 'flex';
  };

  /* ==================== 空状态 ==================== */
  function renderEmpty() {
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
    if (!keyword) {
      renderLinks(allLinks);
      return;
    }
    const filtered = allLinks.filter(link =>
      (link.title || '').toLowerCase().includes(keyword) ||
      (link.description || '').toLowerCase().includes(keyword) ||
      (link.url || '').toLowerCase().includes(keyword) ||
      (link.category || '').toLowerCase().includes(keyword)
    );
    renderLinks(filtered);
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
