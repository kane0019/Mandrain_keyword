/**
 * Background Service Worker - 逻辑与通信层
 * 职责：
 * 1. 接收content script的查询请求
 * 2. 本地词库O(1)时间复杂度查询
 * 3. 云端API降级请求（2000ms超时控制）
 * 4. 网络容灾与优雅降级
 * 5. 生词本存储管理
 */

// 本地词库缓存（内存级，应用启动时加载）
let localDB = null;

/**
 * 启动时加载本地词库
 */
async function loadLocalDB() {
  try {
    const response = await fetch(chrome.runtime.getURL('local_db.json'));
    localDB = await response.json();
    console.log(`[Mandrain] 本地词库加载成功，共${Object.keys(localDB).length}条词条`);
  } catch (error) {
    console.error('[Mandrain] 本地词库加载失败:', error);
    localDB = {};
  }
}

// Service Worker启动时加载词库
loadLocalDB();

/**
 * 监听来自content script的消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'queryWord') {
    handleWordQuery(request, sendResponse);
  } else if (request.action === 'saveWordbook') {
    handleSaveWordbook(request, sendResponse);
  }
  // 异步响应，保持连接开放
  return true;
});

/**
 * 主查询逻辑 - 本地优先 + 云端降级
 */
async function handleWordQuery(request, sendResponse) {
  const { word, context } = request;

  // 步骤1：本地词库查询 O(1)
  const localResult = queryLocalDB(word);
  if (localResult) {
    sendResponse({
      success: true,
      data: localResult,
      source: 'local'
    });
    return;
  }

  // 步骤2：本地未命中，发起云端API请求（带超时控制）
  try {
    const cloudResult = await queryCloudAPI(word, context);
    sendResponse({
      success: true,
      data: cloudResult,
      source: 'cloud'
    });
  } catch (error) {
    // 步骤3：云端容灾 - 优雅降级
    console.warn('[Mandrain] 云端请求失败，进入降级模式:', error.message);
    const fallbackResult = generateFallback(word);
    sendResponse({
      success: true,
      data: fallbackResult,
      source: 'fallback',
      error: error.message
    });
  }
}

/**
 * 本地词库查询 - O(1)时间复杂度
 * @param {string} word 查询词汇
 * @returns {object|null} 查询结果或null
 */
function queryLocalDB(word) {
  if (!localDB) return null;

  // 精确匹配
  if (localDB[word]) {
    return localDB[word];
  }

  // 可选：模糊匹配（如果严格匹配未命中）
  // const fuzzyMatch = Object.keys(localDB).find(key => key.includes(word));
  // if (fuzzyMatch) {
  //   return localDB[fuzzyMatch];
  // }

  return null;
}

/**
 * 云端API查询 - 带2000ms超时控制
 * @param {string} word 查询词汇
 * @param {object} context 语义上下文
 * @returns {Promise<object>} 云端API响应
 */
async function queryCloudAPI(word, context) {
  const API_ENDPOINT = 'https://api.example.com/v1/analyze'; // 替换为实际API地址
  const TIMEOUT_MS = 2000;

  // 构建请求Payload
  const payload = {
    word: word,
    context: context.fullContext,
    prefix: context.prefix,
    suffix: context.suffix,
    timestamp: new Date().toISOString()
  };

  // 创建超时Promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`API request timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
  });

  // 创建fetch Promise
  const fetchPromise = fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mandrain-Version': '1.0.0'
    },
    body: JSON.stringify(payload)
  }).then(async (response) => {
    // HTTP 403或其他错误处理
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  });

  // Promise竞速：哪个先完成就用哪个
  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * 优雅降级 - 当云端请求失败时，提供基础翻译
 * @param {string} word 查询词汇
 * @returns {object} 降级数据
 */
function generateFallback(word) {
  return {
    word: word,
    literal: '字面意：[云端语义解析当前不可用]',
    implication: '—',
    sentiment: '—',
    degraded: true,
    message: '云端语义解析当前不可用，已为您展示基础字面翻译。'
  };
}

/**
 * 保存到生词本
 * @param {object} request 包含word entry的请求
 * @param {function} sendResponse 响应回调
 */
async function handleSaveWordbook(request, sendResponse) {
  try {
    const { entry } = request;
    
    // 从存储中读取现有词条
    const result = await chrome.storage.local.get('wordbook');
    const wordbook = result.wordbook || [];
    
    // 检查是否重复
    const exists = wordbook.some(item => item.word === entry.word);
    if (exists) {
      sendResponse({
        success: false,
        message: '词条已存在'
      });
      return;
    }

    // 添加新词条
    wordbook.push(entry);
    await chrome.storage.local.set({ wordbook });

    sendResponse({
      success: true,
      message: '已保存到生词本'
    });
  } catch (error) {
    console.error('[Mandrain] 保存词条失败:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * 获取生词本（可在popup或options页面中使用）
 */
async function getWordbook() {
  const result = await chrome.storage.local.get('wordbook');
  return result.wordbook || [];
}
