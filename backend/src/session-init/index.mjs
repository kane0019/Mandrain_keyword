import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { signJwt } from '../shared/jwt.mjs';
import { response, parseBody } from '../shared/response.mjs';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const LICENSES_TABLE = process.env.LICENSES_TABLE;
const DEVICES_TABLE = process.env.DEVICES_TABLE;
const ANALYZE_STREAM_URL = process.env.ANALYZE_STREAM_URL || '';

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  const body = parseBody(event);
  if (!body) {
    return response(400, { error: 'INVALID_REQUEST', message: 'Invalid JSON body' });
  }

  const { license_token, install_id, client_version, platform } = body;

  // ---------- Input validation ----------
  if (!license_token || typeof license_token !== 'string') {
    return response(400, { error: 'TOKEN_MISSING', message: 'license_token is required' });
  }
  if (!install_id || typeof install_id !== 'string') {
    return response(400, { error: 'INVALID_REQUEST', message: 'install_id is required' });
  }

  // ---------- 1. 查 licenses 表 ----------
  const licenseResult = await ddbClient.send(new GetCommand({
    TableName: LICENSES_TABLE,
    Key: { license_token },
  }));

  const license = licenseResult.Item;
  if (!license) {
    return response(401, { error: 'TOKEN_INVALID', message: 'License token not found' });
  }

  if (license.status !== 'active') {
    return response(401, { error: 'SUBSCRIPTION_INACTIVE', message: 'Subscription is not active' });
  }

  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return response(401, { error: 'SUBSCRIPTION_INACTIVE', message: 'Subscription has expired' });
  }

  // ---------- 2. 查 devices 表 — 设备数量校验 ----------
  const devicesResult = await ddbClient.send(new QueryCommand({
    TableName: DEVICES_TABLE,
    KeyConditionExpression: 'license_token = :tk',
    FilterExpression: 'is_active = :active',
    ExpressionAttributeValues: {
      ':tk': license_token,
      ':active': true,
    },
  }));

  const activeDevices = devicesResult.Items || [];
  const maxDevices = license.max_devices || 1;
  const alreadyRegistered = activeDevices.some(d => d.install_id === install_id);

  if (activeDevices.length >= maxDevices && !alreadyRegistered) {
    return response(403, {
      error: 'DEVICE_LIMIT_EXCEEDED',
      message: `Device limit reached (${maxDevices})`,
      max_devices: maxDevices,
      device_count: activeDevices.length,
    });
  }

  // ---------- 3. 写入/更新 devices 表 ----------
  const now = new Date().toISOString();
  await ddbClient.send(new PutCommand({
    TableName: DEVICES_TABLE,
    Item: {
      license_token,
      install_id,
      platform: platform || 'unknown',
      client_version: client_version || 'unknown',
      first_seen: alreadyRegistered
        ? activeDevices.find(d => d.install_id === install_id).first_seen
        : now,
      last_seen: now,
      is_active: true,
    },
  }));

  const deviceCount = alreadyRegistered ? activeDevices.length : activeDevices.length + 1;

  // ---------- 4. 签发 JWT ----------
  const accessToken = await signJwt({
    sub: install_id,
    plan: license.plan,
    license_token,
  });

  // ---------- 5. 返回 ----------
  return response(200, {
    access_token: accessToken,
    expires_in: 3600,
    plan: license.plan,
    device_count: deviceCount,
    max_devices: maxDevices,
    stream_url: ANALYZE_STREAM_URL,
    feature_flags: {
      cloud_analysis: license.plan !== 'free',
    },
  });
}
