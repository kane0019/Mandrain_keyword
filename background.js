/**
 * Background Service Worker - 逻辑与通信层
 * 职责：
 * 1. 接收content script的查询请求
 * 2. 本地词库O(1)时间复杂度查询
 * 3. 云端API降级请求（2000ms超时控制）
 * 4. 网络容灾与优雅降级
 * 5. 会话初始化（session/init）与鉴权状态管理
 */

const API_BASE_URL = 'https://api.example.com/v1'; // 替换为实际后端地址
const SESSION_INIT_ENDPOINT = `${API_BASE_URL}/session/init`;
const ANALYZE_ENDPOINT = `${API_BASE_URL}/analyze`;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_FREE_LICENSE_TOKEN = 'free-token-placeholder';

const STORAGE_KEYS = {
  INSTALL_ID: 'auth.install_id',
  LICENSE_TOKEN: 'auth.license_token',
  SESSION: 'auth.session'
};

// 本地词库缓存（内存级，应用启动时加载）
let localDB = null;
let localDBLoadPromise = null;
let installIdCache = null;

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
  if (localDB !== null) return Promise.resolve();

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
    return true;
  }

  if (request.action === 'authInitSession') {
    handleAuthInitSession(request, sendResponse);
    return true;
  }

  if (request.action === 'authSetToken') {
    handleAuthSetToken(request, sendResponse);
    return true;
  }

  if (request.action === 'authGetState') {
    handleAuthGetState(sendResponse);
    return true;
  }

  sendResponse({
    success: false,
    error: 'unsupported_action'
  });
  return false;
});

// Service Worker启动时预热
ensureLocalDBReady();
bootstrapAuth().catch((error) => {
  console.warn('[Mandrain] bootstrap auth skipped:', error.message);
});

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
  try {
    const cloudResult = await queryCloudAPI(queryWord, request.context);
    console.log('[Mandrain] cloud result', cloudResult);
    sendResponse({
      success: true,
      data: cloudResult,
      source: 'cloud'
    });
  } catch (error) {
    console.warn('[Mandrain] 云端请求失败，进入降级模式:', error.message);
    const fallbackResult = generateFallback(queryWord);
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
  return localDB[word] || null;
}

/**
 * 云端API查询 - 会话鉴权 + 超时控制
 * @param {string} word 查询词汇
 * @param {object} context 语义上下文
 * @returns {Promise<object>} 云端API响应
 */
async function queryCloudAPI(word, context) {
  const session = await initSession();
  const payload = {
    word: word,
    context: context?.fullContext || '',
    prefix: context?.prefix || '',
    suffix: context?.suffix || '',
    timestamp: new Date().toISOString()
  };

  return postJsonWithTimeout(
    ANALYZE_ENDPOINT,
    payload,
    2000,
    {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Install-Id': session.installId,
      'X-Mandrain-Version': chrome.runtime.getManifest().version
    }
  );
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

async function bootstrapAuth() {
  await ensureInstallId();
  await initSession();
}

async function handleAuthInitSession(request, sendResponse) {
  try {
    const session = await initSession({
      force: Boolean(request?.force)
    });
    sendResponse({
      success: true,
      data: sanitizeSession(session)
    });
  } catch (error) {
    sendResponse({
      success: false,
      code: error.code || 'SESSION_INIT_FAILED',
      error: error.message
    });
  }
}

async function handleAuthSetToken(request, sendResponse) {
  const rawToken = typeof request?.token === 'string' ? request.token.trim() : '';

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LICENSE_TOKEN]: rawToken
    });
    await chrome.storage.local.remove(STORAGE_KEYS.SESSION);

    const session = await initSession({ force: true });
    sendResponse({
      success: true,
      data: sanitizeSession(session)
    });
  } catch (error) {
    sendResponse({
      success: false,
      code: error.code || 'SET_TOKEN_FAILED',
      error: error.message
    });
  }
}

async function handleAuthGetState(sendResponse) {
  try {
    const installId = await ensureInstallId();
    const session = await getStoredSession();
    const tokenResult = await chrome.storage.local.get(STORAGE_KEYS.LICENSE_TOKEN);
    const customToken = String(tokenResult[STORAGE_KEYS.LICENSE_TOKEN] || '').trim();

    sendResponse({
      success: true,
      data: {
        installId: installId,
        hasCustomToken: Boolean(customToken),
        sessionValid: isSessionUsable(session),
        session: sanitizeSession(session)
      }
    });
  } catch (error) {
    sendResponse({
      success: false,
      code: error.code || 'GET_STATE_FAILED',
      error: error.message
    });
  }
}

async function ensureInstallId() {
  if (installIdCache) return installIdCache;

  const result = await chrome.storage.local.get(STORAGE_KEYS.INSTALL_ID);
  const stored = String(result[STORAGE_KEYS.INSTALL_ID] || '').trim();
  if (stored) {
    installIdCache = stored;
    return installIdCache;
  }

  installIdCache = generateInstallId();
  await chrome.storage.local.set({
    [STORAGE_KEYS.INSTALL_ID]: installIdCache
  });
  return installIdCache;
}

function generateInstallId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function getEffectiveLicenseToken() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LICENSE_TOKEN);
  const customToken = String(result[STORAGE_KEYS.LICENSE_TOKEN] || '').trim();
  if (customToken) return customToken;
  return DEFAULT_FREE_LICENSE_TOKEN;
}

async function initSession(options = {}) {
  const { force = false } = options;

  if (!force) {
    const cachedSession = await getStoredSession();
    if (isSessionUsable(cachedSession)) {
      return cachedSession;
    }
  }

  const installId = await ensureInstallId();
  const licenseToken = await getEffectiveLicenseToken();
  if (!licenseToken) {
    throw createAppError('TOKEN_MISSING', 'license token missing');
  }

  const manifest = chrome.runtime.getManifest();
  const payload = {
    license_token: licenseToken,
    install_id: installId,
    client_version: manifest.version,
    extension_id: chrome.runtime.id,
    platform: globalThis.navigator?.platform || 'unknown',
    timestamp: new Date().toISOString()
  };

  const rawResponse = await postJsonWithTimeout(
    SESSION_INIT_ENDPOINT,
    payload,
    SESSION_TIMEOUT_MS,
    {
      'X-Mandrain-Version': manifest.version
    }
  );

  const session = normalizeSession(rawResponse, installId);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: session
  });
  return session;
}

async function getStoredSession() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  return result[STORAGE_KEYS.SESSION] || null;
}

function isSessionUsable(session) {
  if (!session || !session.accessToken) return false;
  const expiresAt = Number(session.expiresAt || 0);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt - 30000;
}

function normalizeSession(raw, installId) {
  const accessToken = String(raw?.access_token || '').trim();
  if (!accessToken) {
    throw createAppError('SESSION_TOKEN_MISSING', 'session_init missing access_token');
  }

  const expiresInRaw = Number(raw?.expires_in);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 3600;

  return {
    accessToken: accessToken,
    plan: String(raw?.plan || 'free'),
    expiresAt: Date.now() + expiresIn * 1000,
    deviceCount: Number(raw?.device_count || 1),
    maxDevices: Number(raw?.max_devices || 3),
    featureFlags: raw?.feature_flags || {},
    installId: installId,
    updatedAt: Date.now()
  };
}

function sanitizeSession(session) {
  if (!session) return null;

  return {
    plan: session.plan || 'free',
    expiresAt: session.expiresAt || 0,
    deviceCount: session.deviceCount || 0,
    maxDevices: session.maxDevices || 0,
    featureFlags: session.featureFlags || {},
    installId: session.installId || '',
    hasAccessToken: Boolean(session.accessToken)
  };
}

async function postJsonWithTimeout(url, payload, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      throw createAppError(
        data.code || `HTTP_${response.status}`,
        data.message || `HTTP ${response.status}`,
        response.status
      );
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw createAppError('REQUEST_TIMEOUT', `request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAppError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
