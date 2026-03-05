/**
 * Popup Script - 生词本管理页面
 * 职责：
 * 1. 从 chrome.storage 读取保存的词条
 * 2. 渲染生词本列表
 * 3. 处理删除、导出等操作
 */

let wordbook = [];

/**
 * 页面初始化
 */
document.addEventListener('DOMContentLoaded', async () => {
  await loadWordbook();
  renderWordbook();
  
  // 绑定清空按钮
  document.getElementById('clearAllBtn').addEventListener('click', clearAllWords);
});

/**
 * 加载生词本
 */
async function loadWordbook() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['wordbook'], (result) => {
      wordbook = result.wordbook || [];
      updateStats();
      resolve();
    });
  });
}

/**
 * 渲染生词本列表
 */
function renderWordbook() {
  const container = document.getElementById('wordbookContainer');
  
  if (wordbook.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📖</div>
        <p>暂无保存的词汇</p>
        <p style="font-size: 11px; margin-top: 8px;">划词时点击"保存"来添加</p>
      </div>
    `;
    return;
  }

  // 按时间倒序排列
  const sortedWordbook = [...wordbook].sort((a, b) => {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  container.innerHTML = sortedWordbook.map((entry, index) => `
    <div class="word-item">
      <div class="word-title">${escapeHtml(entry.word)}</div>
      <div class="word-detail">
        <span class="word-detail-label">字面意</span>
        ${escapeHtml(entry.literal || '—')}
      </div>
      <div class="word-detail">
        <span class="word-detail-label">潜台词</span>
        ${escapeHtml(entry.implication || '—')}
      </div>
      <div class="word-detail">
        <span class="word-detail-label">色彩</span>
        ${escapeHtml(entry.sentiment || '—')}
      </div>
      <div class="word-actions">
        <button class="word-btn" onclick="copyWord('${escapeHtml(entry.word)}')">复制</button>
        <button class="word-btn" onclick="deleteWord(${index})">删除</button>
      </div>
    </div>
  `).join('');
}

/**
 * 复制词条
 */
function copyWord(word) {
  const text = `
"${word}"
字面意: ${wordbook.find(w => w.word === word)?.literal || '—'}
潜台词: ${wordbook.find(w => w.word === word)?.implication || '—'}
情绪色彩: ${wordbook.find(w => w.word === word)?.sentiment || '—'}
  `.trim();

  navigator.clipboard.writeText(text).then(() => {
    alert('已复制到剪贴板');
  });
}

/**
 * 删除词条
 */
async function deleteWord(index) {
  if (confirm('确定删除这个词条吗？')) {
    wordbook.splice(index, 1);
    await chrome.storage.local.set({ wordbook });
    renderWordbook();
    updateStats();
  }
}

/**
 * 清空所有词条
 */
async function clearAllWords() {
  if (confirm('确定要清空所有词条吗？此操作不可撤销。')) {
    wordbook = [];
    await chrome.storage.local.set({ wordbook: [] });
    renderWordbook();
    updateStats();
  }
}

/**
 * 更新统计信息
 */
function updateStats() {
  const statsText = document.getElementById('statsText');
  statsText.textContent = `共 ${wordbook.length} 个词汇`;
}

/**
 * HTML转义，防止XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
