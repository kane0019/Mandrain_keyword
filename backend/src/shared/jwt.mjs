import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SignJWT, jwtVerify } from 'jose';

const secretsClient = new SecretsManagerClient();
let cachedSecret = null;

/**
 * 从 Secrets Manager 获取 JWT 签名密钥（冷启动时加载一次，后续复用）
 */
export async function getJwtSecret() {
  if (cachedSecret) return cachedSecret;

  const resp = await secretsClient.send(new GetSecretValueCommand({
    SecretId: process.env.JWT_SECRET_ARN,
  }));

  // Support both plain string and JSON {"jwt_signing_key": "..."} formats
  let key = resp.SecretString;
  try {
    const parsed = JSON.parse(key);
    key = parsed.jwt_signing_key || parsed.secret || key;
  } catch (_) {
    // plain string, use as-is
  }
  cachedSecret = new TextEncoder().encode(key);
  return cachedSecret;
}

/**
 * 签发 JWT
 */
export async function signJwt(payload) {
  const secret = await getJwtSecret();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

/**
 * 验证 JWT，返回 payload 或 null
 */
export async function verifyJwt(token) {
  try {
    const secret = await getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
