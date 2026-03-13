import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { verifyJwt } from '../shared/jwt.mjs';
import { response, parseBody } from '../shared/response.mjs';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const bedrockClient = new BedrockRuntimeClient();
const WORD_CACHE_TABLE = process.env.WORD_CACHE_TABLE;
const MAX_TEXT_LENGTH = 30;
const CACHE_TTL_SECONDS = process.env.CACHE_TTL_SECONDS ? parseInt(process.env.CACHE_TTL_SECONDS) : 86400; // default 24h

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  // ---------- 1. JWT 验证 ----------
  const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return response(401, { error: 'TOKEN_MISSING', message: 'Authorization header is required' });
  }

  const jwtPayload = await verifyJwt(token);
  if (!jwtPayload) {
    return response(401, { error: 'TOKEN_INVALID', message: 'Invalid or expired access token' });
  }

  // ---------- 2. 解析入参 ----------
  const body = parseBody(event);
  if (!body) {
    return response(400, { error: 'INVALID_REQUEST', message: 'Invalid JSON body' });
  }

  const { text, prefix, suffix, page_url, lang } = body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return response(400, { error: 'EMPTY_TEXT', message: 'text field is required' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return response(400, { error: 'TEXT_TOO_LONG', message: `text exceeds ${MAX_TEXT_LENGTH} characters` });
  }

  const queryText = text.trim();
  const queryLang = lang || 'zh';

  // ---------- 3. 查 word_cache 表 ----------
  const cacheResult = await ddbClient.send(new GetCommand({
    TableName: WORD_CACHE_TABLE,
    Key: { text: queryText, lang: queryLang },
  }));

  if (cacheResult.Item) {
    const cached = cacheResult.Item;
    return response(200, {
      zh: cached.zh,
      en: cached.en,
      definition: cached.definition,
      implication: cached.implication,
      sentiment: cached.sentiment,
      source: 'cache',
    });
  }

  // ---------- 4. 调用 Bedrock Claude ----------
  const prompt = buildPrompt(queryText, prefix, suffix, page_url);
  const aiResult = await invokeBedrockClaude(prompt);

  if (!aiResult) {
    return response(502, { error: 'AI_SERVICE_ERROR', message: 'Failed to get analysis from AI service' });
  }

  // ---------- 5. 写入缓存 ----------
  const ttl = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;
  await ddbClient.send(new PutCommand({
    TableName: WORD_CACHE_TABLE,
    Item: {
      text: queryText,
      lang: queryLang,
      zh: aiResult.zh || queryText,
      en: aiResult.en || '',
      definition: aiResult.definition || '',
      implication: aiResult.implication || '',
      sentiment: aiResult.sentiment || 'neutral',
      model: aiResult._model || 'unknown',
      source: 'cloud',
      ttl,
    },
  }));

  // ---------- 6. 返回结果 ----------
  return response(200, {
    zh: aiResult.zh || queryText,
    en: aiResult.en || '',
    definition: aiResult.definition || '',
    implication: aiResult.implication || '',
    sentiment: aiResult.sentiment || 'neutral',
    model: aiResult._model || 'unknown',
    source: 'cloud',
  });
}

const SYSTEM_PROMPT = '你是中文语义分析专家，专注于网络语言、俚语和文化内涵分析。严格按以下JSON格式返回，不含其他文字，每个字段限50字以内：{"zh":"原词","en":"最贴切英文等价词(网络语给俚语而非字面直译)","definition":"字面含义(英文,简短)","implication":"当代中文语境真实含义(英文,简短)","sentiment":"positive或negative或neutral"}';

const DEEPSEEK_IDLE_TIMEOUT_MS = 8000;  // 8s 无新 chunk 才判定超时
const DEEPSEEK_TOTAL_TIMEOUT_MS = 25000; // 25s 绝对上限，为 API GW 29s 留缓冲
const NOVA_PRO_MODEL_ID = 'amazon.nova-pro-v1:0';
const DEEPSEEK_MODEL_ID = 'deepseek.v3.2';

function buildPrompt(text, prefix, suffix, pageUrl) {
  let userMsg = `词汇: ${text}`;
  if (prefix) userMsg += `\n前文: ${prefix}`;
  if (suffix) userMsg += `\n后文: ${suffix}`;
  if (pageUrl) userMsg += `\n来源: ${pageUrl}`;
  return userMsg;
}

function parseJsonFromText(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

async function invokeDeepSeek(prompt) {
  const requestBody = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 256,
    temperature: 0.3,
  };
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: DEEPSEEK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const resp = await bedrockClient.send(command);
  const stream = resp.body;
  let fullText = '';

  // Collect streamed chunks with inactivity + total timeout
  const result = await new Promise((resolve, reject) => {
    let idleTimer = null;
    const totalTimer = setTimeout(() => {
      clearTimeout(idleTimer);
      reject(new Error(`DeepSeek total timeout (${DEEPSEEK_TOTAL_TIMEOUT_MS}ms)`));
    }, DEEPSEEK_TOTAL_TIMEOUT_MS);

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearTimeout(totalTimer);
        reject(new Error(`DeepSeek idle timeout (${DEEPSEEK_IDLE_TIMEOUT_MS}ms, no new chunk)`));
      }, DEEPSEEK_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();

    (async () => {
      try {
        for await (const event of stream) {
          resetIdleTimer();
          if (event.chunk?.bytes) {
            const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
            const delta = chunk.choices?.[0]?.delta?.content || '';
            fullText += delta;
          }
        }
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        resolve(fullText);
      } catch (err) {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        reject(err);
      }
    })();
  });

  console.log('[DeepSeek-stream] raw response:', result);
  const parsed = parseJsonFromText(result);
  return parsed ? { ...parsed, _model: 'deepseek.v3.2' } : null;
}

async function invokeNovaPro(prompt) {
  const fullPrompt = SYSTEM_PROMPT + '\n\n' + prompt;
  const requestBody = {
    messages: [{ role: 'user', content: [{ text: fullPrompt }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0.3 },
  };
  const command = new InvokeModelCommand({
    modelId: NOVA_PRO_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });
  const resp = await bedrockClient.send(command);
  const respBody = JSON.parse(new TextDecoder().decode(resp.body));
  const text = respBody.output?.message?.content?.[0]?.text || '';
  console.log('[NovaPro] raw response:', text);
  const parsed = parseJsonFromText(text);
  return parsed ? { ...parsed, _model: 'amazon.nova-pro-v1:0' } : null;
}

async function invokeBedrockClaude(prompt) {
  try {
    // 尝试 DeepSeek streaming（内置 idle + total 超时）
    const result = await invokeDeepSeek(prompt);
    if (result) return result;
  } catch (err) {
    console.warn('[Bedrock] DeepSeek failed or timed out, falling back to Nova Pro:', err.message);
  }

  // Fallback: Nova Pro（通常 2-3s，确保不超 API GW 29s 限制）
  try {
    return await invokeNovaPro(prompt);
  } catch (err) {
    console.error('[Bedrock] Nova Pro fallback also failed:', err);
    return null;
  }
}
