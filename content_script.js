/**
 * Content Script - DOM操作层
 * 职责：
 * 1. 监听用户选词事件 (mouseup / 快捷键)
 * 2. 提取选中词汇和语义上下文（前后200字符）
 * 3. 向background发起本地/云端查询请求
 * 4. Shadow DOM注入UI卡片
 * 5. 处理卡片交互事件（关闭、保存等）
 */

// 当前活跃的UI卡片引用，防止重复创建
let activeCard = null;

/**
 * 事件监听 - 鼠标松开时检测是否有文本选中
 */
document.addEventListener('mouseup', () => {
  handleTextSelection();
});

/**
 * 快捷键监听 (可选：Ctrl+/)
 */
document.addEventListener('keydown', (event) => {
  // Ctrl + / 或 Cmd + /
  if ((event.ctrlKey || event.metaKey) && event.key === '/') {
    handleTextSelection();
  }
});

/**
 * 处理文本选择
 */
function handleTextSelection() {
  const selectedText = window.getSelection().toString().trim();

  if (!selectedText || selectedText.length === 0) {
    destroyCard();
    return;
  }

  // 提取选词周围的上下文（前后200字符）
  const context = extractContext(selectedText);

  // 获取鼠标屏幕坐标
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // 向background发送查询请求
  chrome.runtime.sendMessage(
    {
      action: 'queryWord',
      word: selectedText,
      context: context,
      position: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY
      }
    },
    (response) => {
      if (response && response.success) {
        renderCard(response.data, rect);
      } else {
        showErrorCard('查询失败', rect);
      }
    }
  );
}

/**
 * 上下文提取 - 获取选词前后约200字符
 * @param {string} selectedText 用户选中的词汇
 * @returns {object} 包含选词、前缀、后缀的上下文
 */
function extractContext(selectedText) {
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  
  // 克隆Range，向前延伸获取前缀
  const beforeRange = range.cloneRange();
  beforeRange.collapse(true);
  beforeRange.setStart(document.body, 0);
  const beforeText = beforeRange.toString();
  const prefixStartIdx = Math.max(0, beforeText.length - 200);
  const prefix = beforeText.slice(prefixStartIdx);

  // 向后延伸获取后缀
  const afterRange = range.cloneRange();
  afterRange.collapse(false);
  const afterText = afterRange.toString();
  const suffix = afterText.slice(0, 200);

  return {
    prefix: prefix,
    word: selectedText,
    suffix: suffix,
    fullContext: prefix + selectedText + suffix
  };
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
  container.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.bottom + 10}px;
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
    }
    .card-label {
      color: #666;
      font-weight: 500;
      display: inline-block;
      width: 60px;
      vertical-align: top;
    }
    .card-content {
      display: inline-block;
      width: calc(100% - 70px);
      color: #333;
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

  // 构建卡片HTML
  const cardHTML = `
    <div class="card">
      <div class="card-close">✕</div>
      <div class="card-title">"${data.word || ''}"</div>
      <div class="card-item">
        <span class="card-label">字面意</span>
        <span class="card-content">${data.literal || '—'}</span>
      </div>
      <div class="card-item">
        <span class="card-label">潜台词</span>
        <span class="card-content">${data.implication || '—'}</span>
      </div>
      <div class="card-item">
        <span class="card-label">色彩</span>
        <span class="card-content">${data.sentiment || '—'}</span>
      </div>
      <div class="card-footer">
        <button class="card-btn card-btn-save">保存</button>
        <button class="card-btn card-btn-copy">复制</button>
      </div>
    </div>
  `;

  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = cardHTML;
  shadowRoot.appendChild(cardDiv);

  // 事件绑定
  shadowRoot.querySelector('.card-close').addEventListener('click', destroyCard);
  shadowRoot.querySelector('.card-btn-save').addEventListener('click', () => {
    saveToWordbook(data);
  });
  shadowRoot.querySelector('.card-btn-copy').addEventListener('click', () => {
    copyToClipboard(data);
  });

  // 外部点击销毁卡片
  document.addEventListener('click', onOutsideClick);

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
  container.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.bottom + 10}px;
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
  `;
  shadowRoot.appendChild(style);

  const cardDiv = document.createElement('div');
  cardDiv.innerHTML = `<div class="card">${message}</div>`;
  shadowRoot.appendChild(cardDiv);

  document.body.appendChild(container);
  activeCard = container;

  // 3秒后自动销毁
  setTimeout(destroyCard, 3000);
}

/**
 * 销毁卡片 - 从DOM树中移除，释放内存
 */
function destroyCard() {
  if (activeCard) {
    activeCard.remove();
    activeCard = null;
  }
  // 移除事件监听器
  document.removeEventListener('click', onOutsideClick);
  document.removeEventListener('keydown', onEscKey);
}

/**
 * 外部点击事件处理
 */
function onOutsideClick(event) {
  if (activeCard && !activeCard.contains(event.target)) {
    destroyCard();
  }
}

/**
 * Esc键事件处理
 */
function onEscKey(event) {
  if (event.key === 'Escape') {
    destroyCard();
  }
}

/**
 * 保存到生词本（示例，可扩展为本地存储或同步云端）
 */
function saveToWordbook(data) {
  const wordEntry = {
    word: data.word,
    literal: data.literal,
    implication: data.implication,
    sentiment: data.sentiment,
    timestamp: new Date().toISOString()
  };

  chrome.runtime.sendMessage(
    {
      action: 'saveWordbook',
      entry: wordEntry
    },
    (response) => {
      if (response?.success) {
        alert('已保存到生词本');
      }
    }
  );
}

/**
 * 复制到剪贴板
 */
function copyToClipboard(data) {
  const text = `
"${data.word}"
字面意: ${data.literal || '—'}
潜台词: ${data.implication || '—'}
情绪色彩: ${data.sentiment || '—'}
  `.trim();

  navigator.clipboard.writeText(text).then(() => {
    alert('已复制到剪贴板');
  });
}
