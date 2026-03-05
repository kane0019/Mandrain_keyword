/**
 * Background Service Worker - 逻辑与通信层
 * 职责：
 * 1. 接收content script的查询请求
 * 2. 本地词库O(1)时间复杂度查询
 * 3. 云端API降级请求（2000ms超时控制）
 * 4. 网络容灾与优雅降级
 */

// 本地词库缓存（内存级，应用启动时加载）
let localDB = null;
let localDBLoadPromise = null;

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

function ensureLocalDBReady() {
  if (localDB !== null) {
    return Promise.resolve();
  }

  if (!localDBLoadPromise) {
    localDBLoadPromise = loadLocalDB().finally(() => {
      localDBLoadPromise = null;
    });
  }

  return localDBLoadPromise;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Mandrain] received message', request);
  if (request.action === 'queryWord') {
    handleWordQuery(request, sendResponse).catch((error) => {
      console.error('[Mandrain] handleWordQuery failed:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    });
  }
  return true;
});

// Service Worker启动时加载词库
ensureLocalDBReady();

/**
 * 主查询逻辑 - 本地优先 + 云端降级
 */
async function handleWordQuery(request, sendResponse) {
  const { word } = request;
  const queryWord = (word || '').trim();

  if (!queryWord) {
    sendResponse({
      success: false,
      error: 'empty_word'
    });
    return;
  }

  await ensureLocalDBReady();
  console.log('[Mandrain] handleWordQuery for', queryWord);

  // 步骤1：本地词库查询 O(1)
  const localResult = queryLocalDB(queryWord);
  if (localResult) {
    console.log('[Mandrain] local hit for', queryWord, '(English mode)');
    sendResponse({
      success: true,
      data: localResult,
      source: 'local'
    });
    return;
  }

  // 测试模式：如果本地未命中，直接返回 Not_Found，无需云端调用
  const notFoundData = {
    zh: queryWord,
    en: 'Not available',
    definition: 'Not_Found',
    implication: 'Not_Found',
    sentiment: 'unknown',
    degraded: true
  };
  console.log('[Mandrain] local miss for', queryWord, ', returning Not_Found placeholder for testing');
  sendResponse({
    success: true,
    data: notFoundData,
    source: 'notfound'
  });
  return;

  /* 原逻辑保留以备将来使用
  console.log('[Mandrain] local miss, querying cloud');
  // 步骤2：本地未命中，发起云端API请求（带超时控制）
  try {
    const cloudResult = await queryCloudAPI(word, context);
    console.log('[Mandrain] cloud result', cloudResult);
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
  */
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
