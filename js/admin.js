/**
 * Captain Link — 管理后台逻辑
 * 负责：密码验证 → 链接CRUD → GitHub API提交 → 自动部署
 */

(function() {
  'use strict';

  /* ==================== 状态管理 ==================== */
  let links = [];
  let editingId = null;
  let ghToken = localStorage.getItem('captain_link_token') || '';

  /* ==================== DOM 元素 ==================== */
  const passwordGate   = document.getElementById('passwordGate');
  const adminPanel     = document.getElementById('adminPanel');
  const passwordInput  = document.getElementById('passwordInput');
  const passwordError  = document.getElementById('passwordError');
  const tokenInput     = document.getElementById('tokenInput');
  const linkForm       = document.getElementById('linkForm');
  const linkList       = document.getElementById('linkList');
  const deployBtn      = document.getElementById('deployBtn');
  const deployStatus   = document.getElementById('deployStatus');
  const addLinkTitle   = document.getElementById('addLinkTitle');

  /* ==================== 密码验证 ==================== */
  window.checkPassword = function() {
    const input = passwordInput.value;
    if (input === CONFIG.adminPassword) {
      passwordGate.style.display = 'none';
      adminPanel.style.display = 'block';
      initAdmin();
    } else {
      passwordInput.classList.add('shake');
      passwordError.style.display = 'block';
      setTimeout(() => {
        passwordInput.classList.remove('shake');
      }, 400);
      passwordInput.value = '';
    }
  };

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

    /* 如果已有 token，显示连接状态 */
    if (ghToken) {
      tokenInput.value = ghToken;
      updateTokenStatus(true);
    }

    renderLinkList();
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

  /* ==================== 渲染链接列表 ==================== */
  function renderLinkList() {
    if (links.length === 0) {
      linkList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">暂无链接，请在上方添加</p>';
      return;
    }

    linkList.innerHTML = links.map((link, index) => `
      <div class="link-list-item">
        <div class="item-info">
          <div class="item-title">${escapeHtml(link.title)}</div>
          <div class="item-url">${escapeHtml(link.url)}</div>
        </div>
        <div class="item-actions">
          <button class="btn icon-btn" onclick="editLink('${link.id}')">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            编辑
          </button>
          <button class="btn btn-danger" onclick="deleteLink('${link.id}')">
            删除
          </button>
        </div>
      </div>
    `).join('');
  }

  /* ==================== 添加/编辑链接 ==================== */
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

    if (editingId) {
      /* 编辑模式 */
      const idx = links.findIndex(l => l.id === editingId);
      if (idx !== -1) {
        links[idx] = { ...links[idx], title, url: finalUrl, description: desc, category: cat };
      }
      editingId = null;
      addLinkTitle.textContent = '添加新链接';
      showToast('链接已更新（记得保存部署）', 'info');
    } else {
      /* 添加模式 */
      const newLink = {
        id: Date.now().toString(),
        title,
        url: finalUrl,
        description: desc,
        category: cat
      };
      links.push(newLink);
      showToast('链接已添加（记得保存部署）', 'success');
    }

    /* 清空表单 */
    linkForm.reset();
    renderLinkList();
  };

  /* ==================== 编辑链接 ==================== */
  window.editLink = function(id) {
    const link = links.find(l => l.id === id);
    if (!link) return;

    document.getElementById('linkTitle').value = link.title || '';
    document.getElementById('linkUrl').value   = link.url || '';
    document.getElementById('linkDesc').value  = link.description || '';
    document.getElementById('linkCat').value   = link.category || '';

    editingId = id;
    addLinkTitle.textContent = '编辑链接';
    /* 滚动到表单 */
    linkForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ==================== 删除链接 ==================== */
  window.deleteLink = function(id) {
    if (!confirm('确定要删除这个链接吗？')) return;
    links = links.filter(l => l.id !== id);
    renderLinkList();
    showToast('链接已删除（记得保存部署）', 'info');
  };

  /* ==================== 取消编辑 ==================== */
  window.cancelEdit = function() {
    editingId = null;
    linkForm.reset();
    addLinkTitle.textContent = '添加新链接';
  };

  /* ==================== GitHub Token 管理 ==================== */
  window.saveToken = function() {
    const token = tokenInput.value.trim();
    if (!token) {
      showToast('请输入 GitHub Token', 'error');
      return;
    }
    ghToken = token;
    localStorage.setItem('captain_link_token', token);
    updateTokenStatus(true);
    showToast('Token 已保存', 'success');
  };

  window.clearToken = function() {
    ghToken = '';
    localStorage.removeItem('captain_link_token');
    tokenInput.value = '';
    updateTokenStatus(false);
    showToast('Token 已清除', 'info');
  };

  function updateTokenStatus(connected) {
    const status = document.getElementById('tokenStatus');
    if (connected) {
      status.className = 'token-status connected';
      status.innerHTML = '● 已连接';
    } else {
      status.className = 'token-status disconnected';
      status.innerHTML = '● 未连接';
    }
  }

  /* ==================== 保存并部署 ==================== */
  window.saveAndDeploy = async function() {
    /* 验证 token */
    if (!ghToken) {
      showToast('请先输入并保存 GitHub Token', 'error');
      tokenInput.focus();
      return;
    }

    /* 验证仓库配置 */
    if (CONFIG.GITHUB_CONFIG.owner === 'YOUR_GITHUB_USERNAME') {
      showToast('请先在 js/config.js 中配置 GitHub 仓库信息', 'error');
      return;
    }

    deployBtn.disabled = true;
    showDeployStatus('deploying', '正在提交到 GitHub 仓库...');

    try {
      const { owner, repo, branch, filePath, commitMessage } = CONFIG.GITHUB_CONFIG;

      /* Step 1: 获取当前文件的 SHA（用于更新） */
      showDeployStatus('deploying', '正在获取文件信息...');
      const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, {
        headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      let sha = null;
      if (fileRes.ok) {
        const fileData = await fileRes.json();
        sha = fileData.sha;
      }

      /* Step 2: 编码新内容并提交 */
      showDeployStatus('deploying', '正在提交链接数据...');
      const content = JSON.stringify({ links }, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(content)));

      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${ghToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          message: commitMessage,
          content: base64Content,
          sha: sha,
          branch: branch
        })
      });

      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(errData.message || `GitHub API 返回 ${updateRes.status}`);
      }

      /* Step 3: 等待部署 */
      showDeployStatus('deploying', '提交成功！等待 CloudFlare 重新部署...');
      await sleep(CONFIG.deployWaitTime);

      /* Step 4: 完成 */
      showDeployStatus('success', '部署完成！正在跳转到首页...');
      showToast('保存部署成功！', 'success');

      await sleep(2000);
      window.location.href = 'index.html';

    } catch (err) {
      console.error('部署失败:', err);
      let errMsg = err.message || '未知错误';
      if (errMsg.includes('401')) errMsg = 'Token 无效或已过期，请检查';
      if (errMsg.includes('404')) errMsg = '仓库不存在或 Token 无仓库权限';
      if (errMsg.includes('403')) errMsg = 'Token 权限不足，需要 repo 权限';
      showDeployStatus('error', '部署失败: ' + errMsg);
      showToast('部署失败: ' + errMsg, 'error');
    } finally {
      deployBtn.disabled = false;
    }
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
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
