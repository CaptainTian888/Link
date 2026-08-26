/**
 * Captain Link — 管理后台逻辑
 * 负责：密码验证 → 链接CRUD（弹窗编辑） → 拖拽排序 → GitHub API提交 → 自动部署
 */

(function() {
  'use strict';

  /* ==================== 状态管理 ==================== */
  let links = [];
  let editingId = null;
  let authToken = '';   // 由管理密码派生，登录成功后保留在内存中供部署使用

  /* ==================== 鉴权令牌派生 ==================== */
  /* 密码经 PBKDF2 派生成 auth token；服务端只保存它的 SHA-256，
     既反推不出密码，环境变量泄漏也换不出可用的令牌。 */
  const AUTH_SALT = 'link-admin-auth-v1';

  async function deriveAuth(password) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new TextEncoder().encode(AUTH_SALT), iterations: 200000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 首次配置 / 改密码时用：在浏览器控制台执行
   *   await printAdminAuthHash('你的新密码')
   * 把打印出的哈希填进 Cloudflare 的 ADMIN_AUTH_HASH 环境变量。
   */
  window.printAdminAuthHash = async function(password) {
    if (!password) return '用法：await printAdminAuthHash(\'你的新密码\')';
    const auth = await deriveAuth(password);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    console.log('ADMIN_AUTH_HASH =', hash);
    return hash;
  };

  /* ==================== DOM 元素 ==================== */
  const passwordGate   = document.getElementById('passwordGate');
  const adminPanel     = document.getElementById('adminPanel');
  const passwordInput  = document.getElementById('passwordInput');
  const passwordError  = document.getElementById('passwordError');
  const linkForm       = document.getElementById('linkForm');
  const linkList       = document.getElementById('linkList');
  const deployBtn      = document.getElementById('deployBtn');
  const recheckBtn     = document.getElementById('recheckBtn');
  const deployStatus   = document.getElementById('deployStatus');
  const editModal      = document.getElementById('editModal');
  const adminBar       = document.getElementById('adminBar');
  const dirtyBadge     = document.getElementById('dirtyBadge');
  const adminSearch    = document.getElementById('adminSearch');
  const urlInput       = document.getElementById('linkUrl');
  const urlFavicon     = document.getElementById('urlFavicon');
  const urlHint        = document.getElementById('urlHint');

  const D = window.LinkDomain;

  /* ==================== 未保存改动追踪 ==================== */
  /* 改了链接但没点保存就关页面 = 白改，这里挡一道 */
  let dirtyCount = 0;

  function markDirty() {
    dirtyCount++;
    renderDirty();
  }

  function clearDirty() {
    dirtyCount = 0;
    renderDirty();
  }

  function renderDirty() {
    if (!dirtyBadge) return;
    dirtyBadge.hidden = dirtyCount === 0;
    dirtyBadge.textContent = `${dirtyCount} 项未保存`;
    if (adminBar) adminBar.classList.toggle('is-dirty', dirtyCount > 0);
  }

  window.addEventListener('beforeunload', function(e) {
    if (dirtyCount === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ==================== 密码验证 ==================== */
  let checkingPassword = false;

  window.checkPassword = async function() {
    if (checkingPassword) return;
    const input = passwordInput.value;
    if (!input) return rejectPassword('请输入密码');

    checkingPassword = true;
    passwordError.style.display = 'none';

    try {
      /* 密码不出浏览器，只把派生出的令牌发给服务端校验 */
      const auth = await deriveAuth(input);
      const res = await fetch(CONFIG.API.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return rejectPassword(err.error || '密码错误，请重试');
      }

      authToken = auth;
      passwordGate.style.display = 'none';
      adminPanel.style.display = 'block';
      initAdmin();
    } catch (err) {
      rejectPassword('无法连接服务端：' + err.message);
    } finally {
      checkingPassword = false;
    }
  };

  function rejectPassword(message) {
    passwordInput.classList.add('shake');
    passwordError.textContent = message;
    passwordError.style.display = 'block';
    setTimeout(() => passwordInput.classList.remove('shake'), 400);
    passwordInput.value = '';
  }

  /* 回车提交密码 */
  if (passwordInput) {
    passwordInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') window.checkPassword();
    });
  }

  /* 切换密码可见性 */
  window.togglePasswordVisibility = function() {
    const input = passwordInput;
    const icon = document.querySelector('.toggle-visibility svg');
    if (input.type === 'password') {
      input.type = 'text';
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>';
    } else {
      input.type = 'password';
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';
    }
  };

  /* ==================== 管理后台初始化 ==================== */
  async function initAdmin() {
    await loadLinks();
    renderLinkList();
    renderDomainMap(links);
  }

  /* ==================== 加载链接数据 ==================== */
  async function loadLinks() {
    try {
      const res = await fetch('links.json?t=' + Date.now());
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      links = data.links || [];
    } catch (err) {
      console.error('加载链接失败:', err);
      links = [];
      showToast('链接数据加载失败', 'error');
    }
  }

  /* ==================== 渲染链接列表（按域名分组） ==================== */

  /* 预览状态角标：和首页的三态一一对应，方便一眼看出哪些站嵌不了 */
  const PREVIEW_LABEL = {
    frame:   { text: '可嵌入', cls: 'ok' },
    shot:    { text: '截图',   cls: 'warn' },
    offline: { text: '离线',   cls: 'bad' }
  };

  function renderLinkList() {
    const countEl = document.getElementById('linkCount');
    if (countEl) countEl.textContent = `(${links.length})`;

    if (links.length === 0) {
      linkList.innerHTML = '<p class="list-placeholder">暂无链接，请在上方添加</p>';
      return;
    }

    const keyword = adminSearch ? adminSearch.value.trim().toLowerCase() : '';
    const visible = keyword
      ? links.filter(l =>
          (l.title || '').toLowerCase().includes(keyword) ||
          (l.url || '').toLowerCase().includes(keyword) ||
          (l.category || '').toLowerCase().includes(keyword))
      : links;

    if (visible.length === 0) {
      linkList.innerHTML = '<p class="list-placeholder">没有匹配的链接</p>';
      return;
    }

    /* 与首页同一套分组逻辑（js/domain.js），保证后台看到的层级 = 前台展示的层级 */
    const { groups, singles } = D.groupLinks(visible);
    const blocks = groups.map(g => buildAdminGroup(g.domain, g.domain, g.links));
    if (singles.length) blocks.push(buildAdminGroup('singles', '独立站点', singles));

    linkList.innerHTML = blocks.join('');
  }

  function buildAdminGroup(id, title, items) {
    return `
      <div class="admin-group">
        <div class="admin-group-head">
          <span class="admin-group-name">${escapeHtml(title)}</span>
          <span class="admin-group-count">${items.length}</span>
        </div>
        ${items.map(link => buildAdminItem(link)).join('')}
      </div>`;
  }

  function buildAdminItem(link) {
    /* 排序按位置算，用的是 links 里的真实下标而不是过滤后的下标 */
    const index = links.findIndex(l => l.id === link.id);
    const badge = PREVIEW_LABEL[link.preview] || null;
    const host = D.hostOf(link.url);

    return `
      <div class="link-list-item" data-link-id="${escapeAttr(link.id)}">
        <img class="item-favicon" alt="" loading="lazy"
             src="${escapeAttr(CONFIG.faviconService + encodeURIComponent(host) + '&sz=32')}"
             onerror="this.style.visibility='hidden'">
        <div class="item-info">
          <div class="item-title">
            ${escapeHtml(link.title)}
            ${badge ? `<span class="preview-tag ${badge.cls}">${badge.text}</span>` : ''}
          </div>
          <div class="item-url">${escapeHtml(link.url)}</div>
        </div>
        <div class="item-actions">
          <button class="btn icon-btn reorder-btn" onclick="moveLinkUp('${escapeAttr(link.id)}')" ${index === 0 ? 'disabled' : ''} title="上移">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
            </svg>
          </button>
          <button class="btn icon-btn reorder-btn" onclick="moveLinkDown('${escapeAttr(link.id)}')" ${index === links.length - 1 ? 'disabled' : ''} title="下移">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <button class="btn icon-btn" onclick="editLink('${escapeAttr(link.id)}')" title="编辑">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            编辑
          </button>
          <button class="btn btn-danger" onclick="deleteLink('${escapeAttr(link.id)}')" title="删除">
            删除
          </button>
        </div>
      </div>`;
  }

  if (adminSearch) adminSearch.addEventListener('input', renderLinkList);

  /* ==================== 添加表单：favicon 预览 + 重复检测 ==================== */
  if (urlInput) {
    urlInput.addEventListener('input', function() {
      const raw = urlInput.value.trim();
      if (!raw) {
        urlFavicon.hidden = true;
        urlHint.hidden = true;
        return;
      }

      const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      const host = D.hostOf(url);

      if (host && host.includes('.')) {
        urlFavicon.src = CONFIG.faviconService + encodeURIComponent(host) + '&sz=32';
        urlFavicon.hidden = false;
      } else {
        urlFavicon.hidden = true;
      }

      const dup = links.find(l => D.hostOf(l.url) === host);
      if (dup) {
        urlHint.textContent = `已存在同域名链接：${dup.title}`;
        urlHint.className = 'field-hint warn';
        urlHint.hidden = false;
      } else {
        urlHint.hidden = true;
      }
    });
  }

  /* ==================== 添加链接（顶部表单） ==================== */
  window.handleLinkSubmit = function(e) {
    e.preventDefault();

    const title = document.getElementById('linkTitle').value.trim();
    const url   = document.getElementById('linkUrl').value.trim();
    const desc  = document.getElementById('linkDesc').value.trim();
    const cat   = document.getElementById('linkCat').value.trim();

    if (!title || !url) {
      showToast('请填写标题和URL', 'error');
      return;
    }

    /* 确保 URL 有协议前缀 */
    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    const newLink = {
      id: Date.now().toString(),
      title,
      url: finalUrl,
      description: desc,
      category: cat
    };

    links.push(newLink);
    markDirty();
    linkForm.reset();
    renderLinkList();
    showToast('链接已添加（记得保存部署）', 'success');
  };

  /* ==================== 编辑链接（弹窗模式） ==================== */
  window.editLink = function(id) {
    const link = links.find(l => l.id === id);
    if (!link) return;

    document.getElementById('editTitle').value = link.title || '';
    document.getElementById('editUrl').value   = link.url || '';
    document.getElementById('editDesc').value  = link.description || '';
    document.getElementById('editCat').value   = link.category || '';

    editingId = id;
    editModal.classList.add('active');
    /* 聚焦标题 */
    setTimeout(() => document.getElementById('editTitle').focus(), 100);
  };

  window.closeEditModal = function() {
    editingId = null;
    editModal.classList.remove('active');
  };

  window.handleEditSubmit = function() {
    const title = document.getElementById('editTitle').value.trim();
    const url   = document.getElementById('editUrl').value.trim();
    const desc  = document.getElementById('editDesc').value.trim();
    const cat   = document.getElementById('editCat').value.trim();

    if (!title || !url) {
      showToast('请填写标题和URL', 'error');
      return;
    }

    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    const idx = links.findIndex(l => l.id === editingId);
    if (idx !== -1) {
      /* 改了 URL 就作废旧的预览判定，等保存时重新探测 */
      const urlChanged = links[idx].url !== finalUrl;
      links[idx] = { ...links[idx], title, url: finalUrl, description: desc, category: cat };
      if (urlChanged) delete links[idx].preview;
      markDirty();
    }

    closeEditModal();
    renderLinkList();
    showToast('链接已更新（记得保存部署）', 'success');
  };

  /* 关闭弹窗：点击遮罩层 */
  if (editModal) {
    editModal.addEventListener('click', function(e) {
      if (e.target === editModal) closeEditModal();
    });
  }

  /* ESC 关闭弹窗 */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && editModal && editModal.classList.contains('active')) {
      closeEditModal();
    }
  });

  /* ==================== 排序：上移 / 下移 ==================== */
  window.moveLinkUp = function(id) {
    const idx = links.findIndex(l => l.id === id);
    if (idx <= 0) return;
    [links[idx], links[idx - 1]] = [links[idx - 1], links[idx]];
    markDirty();
    renderLinkList();
    scrollAndHighlight(id);
  };

  window.moveLinkDown = function(id) {
    const idx = links.findIndex(l => l.id === id);
    if (idx >= links.length - 1) return;
    [links[idx], links[idx + 1]] = [links[idx + 1], links[idx]];
    markDirty();
    renderLinkList();
    scrollAndHighlight(id);
  };

  function scrollAndHighlight(id) {
    /* 延迟一帧等 DOM 重新渲染 */
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-link-id="${id}"]`);
      if (!el) return;

      /* 滚动到视口中间 */
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      /* 高亮动画 */
      el.classList.add('sort-highlight');
      setTimeout(() => el.classList.remove('sort-highlight'), 600);
    });
  }

  /* ==================== 删除链接 ==================== */
  window.deleteLink = function(id) {
    if (!confirm('确定要删除这个链接吗？')) return;
    links = links.filter(l => l.id !== id);
    markDirty();
    renderLinkList();
    showToast('链接已删除（记得保存部署）', 'info');
  };

  /* ==================== 域名拓扑（证书透明度日志反查子域名） ==================== */

  /** 取末两段作为一级域名，与统计口径保持一致 */
  function rootDomainOf(hostname) {
    const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
  }

  function renderDomainMap(links) {
    const listEl = document.getElementById('domainMapList');
    if (!listEl) return;

    /* 按一级域名归拢，记下每个一级域名下已收录的主机名 */
    const groups = new Map();
    links.forEach(link => {
      let host;
      try { host = new URL(link.url).hostname.toLowerCase().replace(/^www\./, ''); }
      catch { return; }
      const root = rootDomainOf(host);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root).add(host);
    });

    if (groups.size === 0) {
      listEl.innerHTML = '<p class="domain-map-empty">暂无域名数据</p>';
      return;
    }

    const roots = [...groups.keys()].sort();
    listEl.innerHTML = roots.map(root => `
      <div class="domain-row" data-domain="${escapeHtml(root)}">
        <button class="domain-row-head" type="button" aria-expanded="false">
          <svg class="domain-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
          <span class="domain-name">${escapeHtml(root)}</span>
          <span class="domain-owned">已收录 ${groups.get(root).size}</span>
        </button>
        <div class="domain-row-body" hidden></div>
      </div>
    `).join('');

    listEl.querySelectorAll('.domain-row-head').forEach(head => {
      head.addEventListener('click', () => toggleDomainRow(head, groups));
    });
  }

  async function toggleDomainRow(head, groups) {
    const row = head.closest('.domain-row');
    const body = row.querySelector('.domain-row-body');
    const domain = row.dataset.domain;
    const expanded = head.getAttribute('aria-expanded') === 'true';

    head.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
    if (expanded || row.dataset.loaded === 'true') return;

    /* 首次展开才发请求，避免主页一次性打十几个慢查询 */
    row.dataset.loaded = 'true';
    body.innerHTML = '<div class="domain-loading"><div class="spinner"></div><span>正在查询证书透明度日志...</span></div>';

    try {
      const res = await fetch('/api/subdomains?domain=' + encodeURIComponent(domain), {
        headers: { 'X-Admin-Auth': authToken }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `服务端返回 ${res.status}`);
      renderSubdomains(body, data, groups.get(domain) || new Set());
    } catch (err) {
      row.dataset.loaded = '';   /* 允许重试 */
      body.innerHTML = `<p class="domain-error">查询失败：${escapeHtml(err.message)}<br><span class="domain-retry">收起后再次展开可重试</span></p>`;
    }
  }

  function renderSubdomains(body, data, owned) {
    const subs = data.subdomains || [];
    if (subs.length === 0) {
      body.innerHTML = '<p class="domain-map-empty">证书日志中没有查到子域名</p>';
      return;
    }

    const items = subs.map(name => {
      const isOwned = owned.has(name);
      return `<li class="domain-sub ${isOwned ? 'is-owned' : ''}">
        <span class="domain-sub-name">${escapeHtml(name)}</span>
        ${isOwned
          ? '<span class="domain-sub-tag">已收录</span>'
          : `<button class="domain-sub-add" type="button" data-host="${escapeAttr(name)}" title="填进上方的添加表单">+ 添加</button>`}
      </li>`;
    }).join('');

    const ownedCount = subs.filter(n => owned.has(n)).length;
    body.innerHTML = `
      <div class="domain-summary">
        共 <strong>${data.total}</strong> 个子域名${data.truncated ? `（仅显示前 ${subs.length} 个）` : ''}
        · 已收录 <strong>${ownedCount}</strong> · 未收录 <strong>${subs.length - ownedCount}</strong>
        <span class="domain-source">来源 ${escapeHtml(data.source || '证书日志')}</span>
      </div>
      <ul class="domain-sub-list">${items}</ul>
    `;

    /* 「+ 添加」把子域名填进上方表单并滚过去，剩下的标题/描述由人补 */
    body.querySelectorAll('.domain-sub-add').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const host = btn.dataset.host;
        document.getElementById('linkUrl').value = 'https://' + host;
        document.getElementById('linkTitle').value = host.split('.')[0];
        document.getElementById('linkUrl').dispatchEvent(new Event('input'));
        linkForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('linkTitle').focus();
        showToast(`已填入 ${host}，补完标题后点「添加链接」`, 'info');
      });
    });
  }

  /* ==================== 保存并部署 ==================== */

  let submitting = false;

  /**
   * 提交 links.json。两个入口共用：
   *   saveAndDeploy()    —— 常规保存，服务端只探测新链接的预览方式
   *   recheckPreviews()  —— 带 recheck，服务端把所有链接重新探测一遍
   */
  async function submitLinks({ recheck, busyBtn, startText, doneText, redirect }) {
    if (submitting) return;
    if (!authToken) {
      showToast('登录状态已失效，请重新输入密码', 'error');
      return;
    }

    submitting = true;
    deployBtn.disabled = true;
    if (recheckBtn) recheckBtn.disabled = true;
    busyBtn.classList.add('is-busy');
    showDeployStatus('deploying', startText);

    try {
      const res = await fetch(CONFIG.API.deploy, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Auth': authToken
        },
        body: JSON.stringify(recheck ? { links, recheck: true } : { links })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `服务端返回 ${res.status}`);

      /* 服务端会把补齐 preview 后的结果回传，同步进本地状态，
         这样列表里的「可嵌入 / 截图 / 离线」角标立刻就是新的 */
      if (Array.isArray(data.links)) {
        links = data.links;
        renderLinkList();
      }
      clearDirty();

      const probedNote = data.probed ? `（探测了 ${data.probed} 个站点）` : '';
      showDeployStatus('deploying', `${doneText}${probedNote}，等待 CloudFlare 重新部署...`);
      await sleep(CONFIG.deployWaitTime);

      showDeployStatus('success', redirect ? '部署完成！正在跳转到首页...' : '部署完成！');
      showToast(doneText, 'success');

      if (redirect) {
        await sleep(1500);
        window.location.href = 'index.html';
      }
    } catch (err) {
      console.error('部署失败:', err);
      /* 服务端已返回中文原因，这里只兜底网络层异常 */
      const errMsg = err.message || '未知错误';
      showDeployStatus('error', '部署失败: ' + errMsg);
      showToast('部署失败: ' + errMsg, 'error');
    } finally {
      submitting = false;
      deployBtn.disabled = false;
      if (recheckBtn) recheckBtn.disabled = false;
      busyBtn.classList.remove('is-busy');
    }
  }

  window.saveAndDeploy = function() {
    return submitLinks({
      recheck: false,
      busyBtn: deployBtn,
      startText: '正在提交链接数据...',
      doneText: '保存成功',
      redirect: true
    });
  };

  window.recheckPreviews = function() {
    return submitLinks({
      recheck: true,
      busyBtn: recheckBtn,
      startText: '正在逐个探测站点能否嵌入预览，可能需要十几秒...',
      doneText: '预览检测完成',
      redirect: false
    });
  };

  /* ==================== 部署状态显示 ==================== */
  function showDeployStatus(type, message) {
    deployStatus.className = 'deploy-status active';
    if (type === 'success') deployStatus.classList.add('success');
    if (type === 'error')   deployStatus.classList.add('error');

    const spinner = type === 'deploying' ? '<div class="spinner"></div>' : '';
    const icon = type === 'success'
      ? '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--success)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>'
      : type === 'error'
      ? '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--danger)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>'
      : '';

    deployStatus.innerHTML = `${spinner}${icon}<span class="status-text">${escapeHtml(message)}</span>`;
  }

  /* ==================== Toast 提示 ==================== */
  let toastTimer = null;
  function showToast(message, type) {
    type = type || 'info';
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.className = 'toast ' + type;

    const icons = {
      success: '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>',
      error:   '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>',
      info:    '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    };

    toast.innerHTML = `${icons[type] || ''}<span>${escapeHtml(message)}</span>`;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  /* ==================== 工具函数 ==================== */
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
