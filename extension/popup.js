/**
 * Popup Script - 设置页交互逻辑
 * 职责：
 * 1. 展示当前会话状态（plan / 设备数）
 * 2. 允许用户填写或重置 license token
 * 3. 提供注册页面链接
 */

const REGISTER_URL = 'https://example.com/register'; // 替换为实际注册页面

const FEEDBACK_MESSAGES = {
  TOKEN_INVALID: 'Token 无效，请检查后重试',
  SUBSCRIPTION_INACTIVE: '订阅已过期，请续费',
  DEVICE_LIMIT_EXCEEDED: '设备数量已达上限（最多3台）',
  TOKEN_MISSING: '缺少 Token',
  SET_TOKEN_FAILED: '保存失败，请重试'
};

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('tokenInput');
  const btnSave = document.getElementById('btnSave');
  const btnReset = document.getElementById('btnReset');
  const feedback = document.getElementById('feedback');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const planLabel = document.getElementById('planLabel');
  const registerLink = document.getElementById('registerLink');

  registerLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: REGISTER_URL });
  });

  btnSave.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      showFeedback('请输入 Token', 'error');
      return;
    }
    saveToken(token);
  });

  btnReset.addEventListener('click', () => {
    tokenInput.value = '';
    saveToken('');
  });

  function saveToken(token) {
    btnSave.disabled = true;
    chrome.runtime.sendMessage(
      { action: 'authSetToken', token: token },
      (response) => {
        btnSave.disabled = false;
        if (chrome.runtime.lastError) {
          showFeedback('通信失败: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (response && response.success) {
          showFeedback(token ? 'Token 已保存，会话已刷新' : '已恢复免费版', 'success');
          updateStatus(response.data);
        } else {
          const msg = FEEDBACK_MESSAGES[response?.code] || response?.error || '保存失败';
          showFeedback(msg, 'error');
        }
      }
    );
  }

  function loadState() {
    chrome.runtime.sendMessage(
      { action: 'authGetState' },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          setStatus('warn', '无法获取状态');
          return;
        }
        updateStatus(response.data?.session);
        if (response.data?.hasCustomToken) {
          tokenInput.placeholder = '已设置付费 Token（重新输入以更换）';
        }
      }
    );
  }

  function updateStatus(session) {
    if (!session) {
      setStatus('warn', '未初始化');
      planLabel.textContent = 'Free';
      return;
    }
    const plan = (session.plan || 'free').charAt(0).toUpperCase() + (session.plan || 'free').slice(1);
    planLabel.textContent = plan;

    if (session.hasAccessToken) {
      const devices = `${session.deviceCount || 0}/${session.maxDevices || 3} 设备`;
      setStatus('ok', `${plan} · ${devices}`);
    } else {
      setStatus('warn', '会话未就绪');
    }
  }

  function setStatus(level, text) {
    statusDot.className = 'status-dot ' + level;
    statusText.textContent = text;
  }

  function showFeedback(msg, type) {
    feedback.textContent = msg;
    feedback.className = 'info ' + type;
    feedback.classList.remove('hidden');
    setTimeout(() => feedback.classList.add('hidden'), 4000);
  }

  // ── 站点黑名单管理 ──────────────────────────────
  const blacklistContainer = document.getElementById('blacklistContainer');

  function loadBlacklist() {
    chrome.runtime.sendMessage({ action: 'blacklistGet' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) return;
      renderBlacklist(response.blacklist);
    });
  }

  function renderBlacklist(list) {
    if (!list || list.length === 0) {
      blacklistContainer.innerHTML = '<span class="blacklist-empty">无</span>';
      return;
    }
    blacklistContainer.innerHTML = list.map((hostname) =>
      `<div class="blacklist-item">
        <span>${hostname}</span>
        <span class="blacklist-remove" data-host="${hostname}">恢复</span>
      </div>`
    ).join('');

    blacklistContainer.querySelectorAll('.blacklist-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const host = btn.getAttribute('data-host');
        chrome.runtime.sendMessage({ action: 'blacklistRemove', hostname: host }, (resp) => {
          if (resp?.success) renderBlacklist(resp.blacklist);
        });
      });
    });
  }

  loadState();
  loadBlacklist();
});
