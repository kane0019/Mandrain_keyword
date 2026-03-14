/**
 * Content Script - DOM操作层
 * 职责：
 * 1. 监听用户选词事件 (mouseup)
 * 2. 提取选中词汇和语义上下文（前后200字符）
 * 3. 向background发起本地/云端查询请求
 * 4. Shadow DOM注入UI卡片
 * 5. 处理卡片交互事件（关闭、复制等）
 */

// 当前活跃的UI卡片引用，防止重复创建
let activeCard = null;
let latestRequestId = 0;
let pendingStreamId = null; // survives card dismissal so stream results still render
let pendingStreamTimer = null; // client-side watchdog: clears loading card if stream goes silent
let lastSelectionSignature = '';
let suppressedSelectionSignature = '';
let lastCardRect = null; // stored for stream updates

const STREAM_CLIENT_TIMEOUT_MS = 30000; // 30s — kills loading card if background goes silent

const ERROR_MESSAGES = {
  TOKEN_INVALID: 'Invalid token — please re-enter in settings',
  SUBSCRIPTION_INACTIVE: 'Subscription expired — please renew',
  DEVICE_LIMIT_EXCEEDED: 'Device limit reached (max 3) — remove an old device first',
  TOKEN_MISSING: 'No token set — please enter one in settings',
  TEXT_TOO_LONG: 'Selection too long — please select a single word or phrase'
};

function getErrorMessage(code) {
  if (code === 'UPGRADE_REQUIRED') return null; // handled by showUpgradeCard
  return ERROR_MESSAGES[code] || '查询失败';
}

// 站点黑名单：检查当前域名是否被停用，是则不注册任何事件监听
let siteDisabled = false;

chrome.storage.local.get('blacklist', (result) => {
  const blacklist = result.blacklist || [];
  const hostname = location.hostname;
  if (blacklist.includes(hostname)) {
    siteDisabled = true;
    console.log('[Mandrain] disabled on', hostname);
    return;
  }
  initListeners();
});

function initListeners() {
  document.addEventListener('mouseup', onDocumentMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);
}

// Re-enable when user removes this site from blacklist (no refresh needed)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'blacklistRemoved' && siteDisabled) {
    siteDisabled = false;
    initListeners();
    console.log('[Mandrain] re-enabled on', location.hostname);
  }
});

function onDocumentMouseUp(event) {
  if (event.button !== 0) return;

  if (activeCard && event.target instanceof Node && activeCard.contains(event.target)) {
    return;
  }

  if (siteDisabled) return;
  handleTextSelection(event.clientX, event.clientY);
}

function onSelectionChange() {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';

  if (!selectedText) {
    // 选区清空后，允许重新查询相同词条
    lastSelectionSignature = '';
    suppressedSelectionSignature = '';
  }
}

/**
 * 处理文本选择
 */
function handleTextSelection(mouseX, mouseY) {
  const snapshot = getSelectionSnapshot(mouseX, mouseY);

  if (!snapshot) {
    destroyCard({ cancelPending: true });
    return;
  }

  const { selectedText, range, rect } = snapshot;
  const selectionSignature = buildSelectionSignature(selectedText, rect);
  console.log('[Mandrain] handleTextSelection got:', selectedText);

  // 关闭卡片后，未改变选区前不重复触发
  if (selectionSignature === suppressedSelectionSignature) {
    return;
  }
  suppressedSelectionSignature = '';

  // 同一选区去重，避免重复查询
  if (selectionSignature === lastSelectionSignature) {
    return;
  }
  lastSelectionSignature = selectionSignature;

  const context = extractContext(range, selectedText);
  const requestId = ++latestRequestId;
  pendingStreamId = null; // cancel any in-flight stream from previous query
  lastCardRect = rect;

  // 向background发送查询请求
  chrome.runtime.sendMessage(
    {
      action: 'queryWord',
      word: selectedText,
      context: context,
      pageUrl: window.location.href,
      requestId: requestId,
      position: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY
      }
    },
    (response) => {
      // 只接收最新请求，丢弃过期响应
      if (requestId !== latestRequestId) {
        return;
      }

      if (chrome.runtime.lastError) {
        console.warn('[Mandrain] runtime error:', chrome.runtime.lastError.message);
        showErrorCard('查询失败', rect);
        return;
      }

      console.log('[Mandrain] received response', response);

      // Streaming mode: show loading card, updates come via streamUpdate messages
      if (response && response.streaming) {
        pendingStreamId = requestId;
        showLoadingCard(rect, selectedText);
        // Watchdog: if background (MV3 service worker) is suspended mid-stream,
        // no events will ever arrive — clear the loading card after 30s.
        clearTimeout(pendingStreamTimer);
        pendingStreamTimer = setTimeout(() => {
          if (pendingStreamId === requestId) {
            pendingStreamId = null;
            showErrorCard('Request timed out — please try again', lastCardRect);
          }
        }, STREAM_CLIENT_TIMEOUT_MS);
        return;
      }

      if (response && response.success) {
        renderCard(response.data, rect);
      } else if (response?.code === 'UPGRADE_REQUIRED') {
        showUpgradeCard(rect, selectedText);
      } else {
        const errorMsg = getErrorMessage(response?.code);
        showErrorCard(errorMsg, rect);
      }
    }
  );
}

/**
 * Compute card (x, y) so it stays within the visible viewport.
 * Prefers below the selection; flips above if it would overflow the bottom.
 * Shifts left if it would overflow the right edge.
 * @param {object} rect  Selection bounding rect (viewport-relative)
 * @param {number} cardW Card width in px (default 320)
 * @param {number} cardH Estimated card height in px (default 220)
 * @returns {{ left: string, top: string }} CSS pixel strings
 */
function computeCardPosition(rect, cardW = 320, cardH = 220) {
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: align to selection left, clamp so card stays in viewport
  let left = rect.left;
  if (left + cardW + margin > vw) left = vw - cardW - margin;
  if (left < margin) left = margin;

  // Vertical: below selection by default, flip above if insufficient space
  let top;
  if (rect.bottom + cardH + margin <= vh) {
    top = rect.bottom + 10;
  } else {
    top = rect.top - cardH - 10;
    if (top < margin) top = margin;
  }

  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
}

function getSelectionSnapshot(fallbackX, fallbackY) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  let rawRect = range.getBoundingClientRect();

  // Some pages return a zero rect (overflow:hidden, CSS transforms, etc.)
  // Try individual line rects first, then fall back to mouse coordinates.
  if (!rawRect || (rawRect.width === 0 && rawRect.height === 0 && rawRect.top === 0)) {
    const clientRects = range.getClientRects();
    if (clientRects.length > 0) {
      rawRect = clientRects[clientRects.length - 1]; // last rect = end of selection
    }
  }

  const isZeroRect = !rawRect || (rawRect.top === 0 && rawRect.left === 0 && rawRect.bottom === 0);
  const rect = isZeroRect && fallbackX != null ? {
    left: fallbackX,
    top: (fallbackY ?? 0) - 20,
    bottom: fallbackY ?? 0,
    width: 0,
    height: 20,
  } : {
    left: rawRect.left,
    top: rawRect.top,
    bottom: rawRect.bottom,
    width: rawRect.width,
    height: rawRect.height,
  };

  return {
    selection,
    selectedText,
    range,
    rect
  };
}

function buildSelectionSignature(selectedText, rect) {
  return `${selectedText}@@${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}

/**
 * 上下文提取 - 获取选词前后约200字符
 * @param {Range} range 当前选区Range
 * @param {string} selectedText 用户选中的词汇
 * @returns {object} 包含选词、前缀、后缀的上下文
 */
function extractContext(range, selectedText) {
  try {
    if (!document.body) {
      return {
        prefix: '',
        word: selectedText,
        suffix: '',
        fullContext: selectedText
      };
    }

    const beforeRange = document.createRange();
    beforeRange.setStart(document.body, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const beforeText = beforeRange.toString();
    const prefixStartIdx = Math.max(0, beforeText.length - 200);
    const prefix = beforeText.slice(prefixStartIdx);

    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEnd(document.body, document.body.childNodes.length);
    const afterText = afterRange.toString();
    const suffix = afterText.slice(0, 200);

    return {
      prefix: prefix,
      word: selectedText,
      suffix: suffix,
      fullContext: prefix + selectedText + suffix
    };
  } catch (error) {
    console.warn('[Mandrain] extractContext failed:', error);
    return {
      prefix: '',
      word: selectedText,
      suffix: '',
      fullContext: selectedText
    };
  }
}

/**
 * Listen for streaming updates from background.js
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'streamUpdate') {
    handleStreamUpdate(message.requestId, message.event);
  }
});

function handleStreamUpdate(requestId, event) {
  // Use pendingStreamId — survives card dismissal (unlike latestRequestId)
  if (requestId !== pendingStreamId) return;

  // Any incoming event resets the watchdog timer
  clearTimeout(pendingStreamTimer);

  if (event.type === 'status') {
    // Restart watchdog on each heartbeat so long-running models don't time out
    pendingStreamTimer = setTimeout(() => {
      if (pendingStreamId === requestId) {
        pendingStreamId = null;
        showErrorCard('Request timed out — please try again', lastCardRect);
      }
    }, STREAM_CLIENT_TIMEOUT_MS);
    updateLoadingStatus(event.stage, event.model);
  } else if (event.type === 'result') {
    pendingStreamId = null;
    renderCard(event.data, lastCardRect);
  } else if (event.type === 'error' && event.error === 'UPGRADE_REQUIRED') {
    pendingStreamId = null;
    showUpgradeCard(lastCardRect, event.text || '');
  } else if (event.type === 'error') {
    pendingStreamId = null;
    const msg = event.message || getErrorMessage(event.error);
    showErrorCard(msg, lastCardRect);
  }
}

function updateLoadingStatus(stage, model) {
  if (!activeCard) return;
  const shadow = activeCard.shadowRoot;
  if (!shadow) return;
  const statusEl = shadow.querySelector('.loading-status');
  if (!statusEl) return;

  const messages = {
    'received':  'Request received',
    'analyzing': 'Analyzing with language engine',
    'thinking':  'Analyzing with language engine',
    'fallback':  'Analyzing with language engine',
  };
  // Keep the loading-dots CSS animation class; just swap the text
  statusEl.textContent = messages[stage] || 'Analyzing with language engine';
}

/**
 * Loading card — shown immediately during streaming, before results arrive
 */
function showLoadingCard(rect, selectedText) {
  destroyCard();

  const container = document.createElement('div');
  container.id = 'mandrain-card-container';
  const { left: posLeft, top: posTop } = computeCardPosition(rect, 320, 80);
  container.style.cssText = `
    position: fixed;
    left: ${posLeft};
    top: ${posTop};
    z-index: 2147483647;
  `;

  const shadowRoot = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      width: 320px;
      background: #fff;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      padding: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #333;
      text-align: center;
    }
    .loading-word {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 10px;
      color: #222;
    }
    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #e0e0e0;
      border-top-color: #666;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-status {
      color: #888;
      font-size: 12px;
    }
    .loading-elapsed {
      color: #bbb;
      font-size: 11px;
      margin-top: 5px;
    }
    .loading-dots::after {
      content: '';
      display: inline-block;
      animation: dots 1.5s steps(4, end) infinite;
    }
    @keyframes dots {
      0%   { content: ''; }
      25%  { content: '.'; }
      50%  { content: '..'; }
      75%  { content: '...'; }
      100% { content: ''; }
    }
    .card-close {
      width: 24px;
      height: 24px;
      position: absolute;
      top: 4px;
      right: 4px;
      cursor: pointer;
      color: #999;
      font-size: 16px;
      line-height: 1;
    }
    .card-close:hover { color: #333; }
  `;
  shadowRoot.appendChild(style);

  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = `
    <div class="card">
      <div class="card-close">✕</div>
      <div class="loading-word">"${selectedText}"</div>
      <div class="loading-spinner"></div>
      <div class="loading-status loading-dots">Connecting</div>
      <div class="loading-elapsed"></div>
    </div>
  `;
  shadowRoot.appendChild(cardDiv);

  shadowRoot.querySelector('.card-close').addEventListener('click', closeCard);

  // Elapsed time counter — shows seconds so user knows backend is alive
  const elapsedEl = shadowRoot.querySelector('.loading-elapsed');
  const startTime = Date.now();
  const elapsedTimer = setInterval(() => {
    if (!document.body.contains(container)) { clearInterval(elapsedTimer); return; }
    const sec = Math.round((Date.now() - startTime) / 1000);
    if (elapsedEl) elapsedEl.textContent = `${sec}s`;
  }, 1000);

  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  document.addEventListener('keydown', onEscKey);

  document.body.appendChild(container);
  activeCard = container;
}

/**
 * Upgrade upsell card — shown when free user hits a term not in local dict or cache
 */
function showUpgradeCard(rect, selectedText) {
  destroyCard();

  const container = document.createElement('div');
  container.id = 'mandrain-card-container';
  const { left: posLeft, top: posTop } = computeCardPosition(rect, 320, 180);
  container.style.cssText = `
    position: fixed;
    left: ${posLeft};
    top: ${posTop};
    z-index: 2147483647;
  `;

  const shadowRoot = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      width: 320px;
      background: #fff;
      border: 1px solid #4a90d9;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      padding: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #333;
      text-align: center;
    }
    .card-word {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 8px;
      color: #222;
    }
    .card-msg {
      color: #666;
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .card-upgrade-btn {
      display: inline-block;
      padding: 8px 20px;
      background: #4a90d9;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .card-upgrade-btn:hover {
      background: #357abd;
    }
    .card-close {
      width: 24px;
      height: 24px;
      position: absolute;
      top: 4px;
      right: 4px;
      cursor: pointer;
      color: #999;
      font-size: 16px;
      line-height: 1;
    }
    .card-close:hover { color: #333; }
  `;
  shadowRoot.appendChild(style);

  const displayText = selectedText ? `"${selectedText}"` : 'This term';
  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = `
    <div class="card">
      <div class="card-close">✕</div>
      <div class="card-word">${displayText}</div>
      <div class="card-msg">
        Full AI analysis is available with Pro.<br>
        Unlock deeper insights, slang detection, and cultural context.
      </div>
      <button class="card-upgrade-btn">Upgrade to Pro</button>
    </div>
  `;
  shadowRoot.appendChild(cardDiv);

  shadowRoot.querySelector('.card-close').addEventListener('click', closeCard);
  shadowRoot.querySelector('.card-upgrade-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openUpgradePage' });
    closeCard();
  });

  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  document.addEventListener('keydown', onEscKey);

  document.body.appendChild(container);
  activeCard = container;
}

/**
 * UI卡片渲染 - 使用Shadow DOM隔离样式
 * @param {object} data 解析结果（字面意、潜台词、情绪色彩等）
 * @param {object} rect 鼠标位置信息
 */
function renderCard(data, rect) {
  // 先销毁之前的卡片
  destroyCard();

  // 创建容器
  const container = document.createElement('div');
  container.id = 'mandrain-card-container';
  const { left: posLeft, top: posTop } = computeCardPosition(rect, 320, 220);
  container.style.cssText = `
    position: fixed;
    left: ${posLeft};
    top: ${posTop};
    z-index: 2147483647;
  `;

  // 创建Shadow DOM根
  const shadowRoot = container.attachShadow({ mode: 'open' });

  // 注入隔离样式
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }
    .card {
      width: 320px;
      background: #fff;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      padding: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #333;
      line-height: 1.6;
    }
    .card-title {
      font-weight: 600;
      color: #222;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .card-item {
      margin-bottom: 8px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .card-label {
      color: #666;
      font-weight: 500;
      flex: 0 0 84px;
    }
    .card-content {
      flex: 1;
      min-width: 0;
      color: #333;
      word-break: break-word;
    }
    .card-footer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e8e8e8;
      display: flex;
      gap: 8px;
    }
    .card-btn {
      flex: 1;
      padding: 6px 8px;
      border: none;
      border-radius: 3px;
      background: #f0f0f0;
      cursor: pointer;
      font-size: 12px;
      color: #333;
      transition: background 0.2s;
    }
    .card-btn:hover {
      background: #e0e0e0;
    }
    .card-close {
      width: 24px;
      height: 24px;
      position: absolute;
      top: 4px;
      right: 4px;
      cursor: pointer;
      color: #999;
      font-size: 16px;
      line-height: 1;
    }
    .card-close:hover {
      color: #333;
    }
  `;
  shadowRoot.appendChild(style);

  // 构建卡片HTML - 英文模式，展示 zh, en, definition, implication, sentiment
  const cardHTML = `
    <div class="card">
      <div class="card-close">✕</div>
      <div class="card-title">"${data.zh || ''}" → "${data.en || ''}"</div>
      <div class="card-item">
        <span class="card-label">Definition</span>
        <span class="card-content">${data.definition || '—'}</span>
      </div>
      <div class="card-item">
        <span class="card-label">Implication</span>
        <span class="card-content">${data.implication || '—'}</span>
      </div>
      <div class="card-item">
        <span class="card-label">Sentiment</span>
        <span class="card-content">${data.sentiment || '—'}</span>
      </div>
      <div class="card-footer">
        <button class="card-btn card-btn-copy">Copy</button>
        <button class="card-btn card-btn-disable">Disable on this site</button>
      </div>
    </div>
  `;

  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = cardHTML;
  shadowRoot.appendChild(cardDiv);

  // 事件绑定
  shadowRoot.querySelector('.card-close').addEventListener('click', closeCard);
  shadowRoot.querySelector('.card-btn-copy').addEventListener('click', () => {
    copyToClipboard(data);
  });
  shadowRoot.querySelector('.card-btn-disable').addEventListener('click', () => {
    disableOnCurrentSite();
  });

  // 外部按下鼠标时销毁卡片（捕获阶段，避免mouseup重入）
  document.addEventListener('pointerdown', onOutsidePointerDown, true);

  // Esc键销毁卡片
  document.addEventListener('keydown', onEscKey);

  document.body.appendChild(container);
  activeCard = container;
}

/**
 * 错误状态卡片渲染
 */
function showErrorCard(message, rect) {
  destroyCard();

  const container = document.createElement('div');
  container.id = 'mandrain-card-container';
  const { left: posLeft, top: posTop } = computeCardPosition(rect, 320, 100);
  container.style.cssText = `
    position: fixed;
    left: ${posLeft};
    top: ${posTop};
    z-index: 2147483647;
  `;

  const shadowRoot = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      width: 320px;
      background: #fff;
      border: 1px solid #ffa500;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      padding: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #666;
    }
    .card-footer {
      margin-top: 10px;
      display: flex;
      justify-content: flex-end;
    }
    .card-btn-disable {
      background: none;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      color: #999;
      cursor: pointer;
    }
    .card-btn-disable:hover {
      border-color: #bbb;
      color: #666;
    }
  `;
  shadowRoot.appendChild(style);

  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = `
    <div class="card">
      ${message}
      <div class="card-footer">
        <button class="card-btn-disable">Disable on this site</button>
      </div>
    </div>
  `;
  shadowRoot.appendChild(cardDiv);

  shadowRoot.querySelector('.card-btn-disable').addEventListener('click', () => {
    disableOnCurrentSite();
  });

  document.body.appendChild(container);
  activeCard = container;

  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  document.addEventListener('keydown', onEscKey);

  // 3秒后自动销毁
  setTimeout(() => destroyCard(), 3000);
}

/**
 * 销毁卡片 - 从DOM树中移除，释放内存
 */
function destroyCard(options = {}) {
  const { cancelPending = false } = options;

  if (cancelPending) {
    // 递增请求序号，丢弃未返回的旧响应
    latestRequestId += 1;
  }

  if (activeCard) {
    activeCard.remove();
    activeCard = null;
  }
  // 移除事件监听器
  document.removeEventListener('pointerdown', onOutsidePointerDown, true);
  document.removeEventListener('keydown', onEscKey);
}

/**
 * 统一关闭入口：关闭后抑制同一选区重复触发
 */
function closeCard() {
  suppressedSelectionSignature = lastSelectionSignature;
  clearSelection();
  destroyCard({ cancelPending: true });
}

function clearSelection() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}

/**
 * 外部点击事件处理
 */
function onOutsidePointerDown(event) {
  if (activeCard && event.target instanceof Node && !activeCard.contains(event.target)) {
    closeCard();
  }
}

/**
 * Esc键事件处理
 */
function onEscKey(event) {
  if (event.key === 'Escape') {
    closeCard();
  }
}

/**
 * 复制到剪贴板
 */
function copyToClipboard(data) {
  const text = `
"${data.zh || data.word || ''}" -> "${data.en || '—'}"
Definition: ${data.definition || data.literal || '—'}
潜台词: ${data.implication || '—'}
情绪色彩: ${data.sentiment || '—'}
  `.trim();

  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard');
  });
}

/**
 * 在当前站点停用插件
 */
function disableOnCurrentSite() {
  const hostname = location.hostname;
  chrome.runtime.sendMessage(
    { action: 'blacklistAdd', hostname: hostname },
    (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.success) {
        siteDisabled = true;
        document.removeEventListener('mouseup', onDocumentMouseUp);
        document.removeEventListener('selectionchange', onSelectionChange);
        destroyCard({ cancelPending: true });
        console.log('[Mandrain] disabled on', hostname);
      }
    }
  );
}
