/**
 * Popup Script - 设置页交互逻辑
 * 职责：
 * 1. 展示当前会话状态（plan / 设备数）
 * 2. 允许用户填写或重置 license token
 * 3. 提供注册页面链接
 */

const REGISTER_URL = 'https://example.com/register'; // 替换为实际注册页面

const FEEDBACK_MESSAGES = {
  TOKEN_INVALID: 'Invalid Token, please check and try again',
  SUBSCRIPTION_INACTIVE: 'Subscription expired, please renew',
  DEVICE_LIMIT_EXCEEDED: 'Device limit reached (max 3)',
  TOKEN_MISSING: 'Token missing',
  SET_TOKEN_FAILED: 'Save failed, please try again'
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
      showFeedback('Please enter a Token', 'error');
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
          showFeedback('Communication error: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (response && response.success) {
          showFeedback(token ? 'Token saved, session refreshed' : 'Restored to free tier', 'success');
          updateStatus(response.data);
        } else {
          const msg = FEEDBACK_MESSAGES[response?.code] || response?.error || 'Save failed';
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
          setStatus('warn', 'Unable to get status');
          return;
        }
        updateStatus(response.data?.session);
        if (response.data?.hasCustomToken) {
          tokenInput.placeholder = 'Paid Token set (re-enter to replace)';
        }
      }
    );
  }

  function updateStatus(session) {
    if (!session) {
      setStatus('warn', 'Not initialized');
      planLabel.textContent = 'Free';
      return;
    }
    const plan = (session.plan || 'free').charAt(0).toUpperCase() + (session.plan || 'free').slice(1);
    planLabel.textContent = plan;

    if (session.hasAccessToken) {
      const devices = `${session.deviceCount || 0}/${session.maxDevices || 3} devices`;
      setStatus('ok', `${plan} · ${devices}`);
    } else {
      setStatus('warn', 'Session not ready');
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
      blacklistContainer.innerHTML = '<span class="blacklist-empty">None</span>';
      return;
    }
    blacklistContainer.innerHTML = list.map((hostname) =>
      `<div class="blacklist-item">
        <span>${hostname}</span>
        <span class="blacklist-remove" data-host="${hostname}">Remove</span>
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
