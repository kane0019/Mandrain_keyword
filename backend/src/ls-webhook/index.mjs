import { createHmac } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secretsmanager';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const smClient = new SecretsManagerClient();

const LICENSES_TABLE = process.env.LICENSES_TABLE;
const LS_SIGNING_SECRET_ARN = process.env.LS_SIGNING_SECRET_ARN;
const EXPECTED_STORE_ID = parseInt(process.env.LS_STORE_ID || '0', 10);
const VARIANT_PLAN_MAP = JSON.parse(process.env.LS_VARIANT_PLAN_MAP || '{}');
// e.g. LS_VARIANT_PLAN_MAP = '{"1398402":"pro"}'

let _signingSecret = null;
async function getSigningSecret() {
  if (_signingSecret) return _signingSecret;
  const resp = await smClient.send(new GetSecretValueCommand({ SecretId: LS_SIGNING_SECRET_ARN }));
  _signingSecret = resp.SecretString;
  return _signingSecret;
}

// ---------- Signature verification ----------
async function verifySignature(rawBody, signatureHeader) {
  const secret = await getSigningSecret();
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

function ok(msg = 'ok') {
  return { statusCode: 200, body: JSON.stringify({ message: msg }) };
}
function reject(code, msg) {
  return { statusCode: code, body: JSON.stringify({ error: msg }) };
}

// ---------- Main handler ----------
export async function handler(event) {
  // CORS preflight
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || '';
  if (httpMethod === 'OPTIONS') return ok();

  // Raw body needed for HMAC — API GW passes it as string
  const rawBody = event.body || '';
  const signature = event.headers?.['x-signature'] || event.headers?.['X-Signature'] || '';
  const eventName = event.headers?.['x-event-name'] || event.headers?.['X-Event-Name'] || '';

  if (!signature) {
    console.warn('[Webhook] Missing X-Signature header');
    return reject(401, 'Missing signature');
  }

  // Verify HMAC-SHA256 signature
  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    console.warn('[Webhook] Invalid signature');
    return reject(401, 'Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reject(400, 'Invalid JSON');
  }

  // Verify store ownership
  const storeId = payload?.data?.attributes?.store_id
    ?? payload?.data?.attributes?.order?.store_id;
  if (EXPECTED_STORE_ID && storeId && storeId !== EXPECTED_STORE_ID) {
    console.warn(`[Webhook] Store ID mismatch: expected ${EXPECTED_STORE_ID}, got ${storeId}`);
    return reject(403, 'Store mismatch');
  }

  console.log(`[Webhook] Processing event: ${eventName}`);

  try {
    switch (eventName) {
      case 'license_key_created':
        await handleLicenseKeyCreated(payload);
        break;
      case 'subscription_created':
        await handleSubscriptionCreated(payload);
        break;
      case 'subscription_updated':
        await handleSubscriptionUpdated(payload);
        break;
      case 'subscription_expired':
        await handleSubscriptionExpired(payload);
        break;
      default:
        console.log(`[Webhook] Ignoring unhandled event: ${eventName}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing ${eventName}:`, err);
    // Return 500 so LS retries (exponential backoff: 5s, 25s, 125s)
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }

  return ok();
}

// ---------- license_key_created ----------
// Fires when a license key is issued for an order (including subscription orders).
// Creates the initial license record in DynamoDB.
async function handleLicenseKeyCreated(payload) {
  const attrs = payload?.data?.attributes;
  if (!attrs) throw new Error('Missing attributes in license_key_created payload');

  const licenseKey = attrs.key;
  const orderId = String(attrs.order_id || '');
  const customerEmail = (attrs.user_email || '').toLowerCase().trim();
  const variantId = String(attrs.variant_id || '');
  const plan = VARIANT_PLAN_MAP[variantId] || 'pro';
  const lsKeyId = String(payload?.data?.id || '');

  if (!licenseKey) throw new Error('No license key in payload');

  console.log(`[Webhook] license_key_created: key=${licenseKey} order=${orderId} email=${customerEmail} plan=${plan}`);

  await ddbClient.send(new PutCommand({
    TableName: LICENSES_TABLE,
    Item: {
      license_token: licenseKey,
      ls_key_id: lsKeyId,
      order_id: orderId,
      customer_email: customerEmail,
      plan,
      status: 'active',
      max_devices: 1,
      // expires_at will be set by subscription_created if trial, or left null for paid
      created_at: new Date().toISOString(),
    },
    // Don't overwrite existing records (idempotency — LS may retry)
    ConditionExpression: 'attribute_not_exists(license_token)',
  }).catch(err => {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`[Webhook] License ${licenseKey} already exists, skipping`);
      return;
    }
    throw err;
  }));
}

// ---------- subscription_created ----------
// Fires alongside license_key_created on first purchase.
// Key use: capture trial_ends_at so we can set expires_at correctly.
async function handleSubscriptionCreated(payload) {
  const attrs = payload?.data?.attributes;
  if (!attrs) return;

  const status = attrs.status; // 'on_trial' | 'active' | etc.
  const trialEndsAt = attrs.trial_ends_at || null;
  const lsSubscriptionId = String(payload?.data?.id || '');

  // Find the license by order_id via first_order_item
  const orderId = String(attrs.order_id || '');
  if (!orderId) return;

  console.log(`[Webhook] subscription_created: sub=${lsSubscriptionId} status=${status} trial_ends_at=${trialEndsAt}`);

  if (status === 'on_trial' && trialEndsAt) {
    // Need to find the license by order_id — scan by order_id using a scan or
    // store subscription_id in license record. Simplest: update using order_id
    // requires a GSI on order_id. Instead, we rely on the ls_key_id or we just
    // let subscription_updated handle it. For now log and handle via subscription_updated.
    console.log(`[Webhook] Trial detected, trial_ends_at=${trialEndsAt} — will update via subscription_updated`);
  }
}

// ---------- subscription_updated ----------
// Fires on every subscription status change.
// We use this to sync status and expiry to our licenses table.
async function handleSubscriptionUpdated(payload) {
  const attrs = payload?.data?.attributes;
  if (!attrs) return;

  const lsStatus = attrs.status;
  // 'on_trial' | 'active' | 'cancelled' | 'paused' | 'past_due' | 'expired' | 'unpaid'
  const trialEndsAt = attrs.trial_ends_at || null;
  const endsAt = attrs.ends_at || null;
  const licenseKey = attrs.first_order_item?.license_key || null;

  // LS doesn't directly put license key in subscription object.
  // We rely on order_id to cross-reference. If we can't find it, skip.
  // Better: store ls_subscription_id in licenses table on license_key_created
  // and query by it. For now, we use user_email as the lookup.
  const customerEmail = (attrs.user_email || attrs.customer_email || '').toLowerCase().trim();

  console.log(`[Webhook] subscription_updated: status=${lsStatus} email=${customerEmail} ends_at=${endsAt} trial_ends_at=${trialEndsAt}`);

  if (!customerEmail) {
    console.warn('[Webhook] No email in subscription_updated payload, cannot update license');
    return;
  }

  // Determine our internal status
  let newStatus;
  let expiresAt = null;
  switch (lsStatus) {
    case 'active':
      newStatus = 'active';
      expiresAt = null; // active subscription, no hard expiry
      break;
    case 'on_trial':
      newStatus = 'active'; // trial users still get access
      expiresAt = trialEndsAt;
      break;
    case 'cancelled':
      newStatus = 'active'; // still active until ends_at (grace period)
      expiresAt = endsAt;
      break;
    case 'expired':
    case 'unpaid':
    case 'past_due':
      newStatus = 'inactive';
      expiresAt = endsAt;
      break;
    default:
      console.log(`[Webhook] Unhandled subscription status: ${lsStatus}`);
      return;
  }

  // Find license by email using the GSI
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const queryResult = await ddbClient.send(new QueryCommand({
    TableName: LICENSES_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'customer_email = :e',
    ExpressionAttributeValues: { ':e': customerEmail },
  }));

  const licenses = queryResult.Items || [];
  if (licenses.length === 0) {
    console.warn(`[Webhook] No license found for email: ${customerEmail}`);
    return;
  }

  // Update all licenses for this email (normally just one)
  await Promise.all(licenses.map(license =>
    ddbClient.send(new UpdateCommand({
      TableName: LICENSES_TABLE,
      Key: { license_token: license.license_token },
      UpdateExpression: 'SET #s = :s, expires_at = :e, updated_at = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': newStatus,
        ':e': expiresAt,
        ':u': new Date().toISOString(),
      },
    }))
  ));

  console.log(`[Webhook] Updated ${licenses.length} license(s) for ${customerEmail}: status=${newStatus} expires_at=${expiresAt}`);
}

// ---------- subscription_expired ----------
// Hard expiry — definitively mark license as inactive.
async function handleSubscriptionExpired(payload) {
  const attrs = payload?.data?.attributes;
  if (!attrs) return;

  const customerEmail = (attrs.user_email || attrs.customer_email || '').toLowerCase().trim();
  if (!customerEmail) return;

  console.log(`[Webhook] subscription_expired: email=${customerEmail}`);

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const queryResult = await ddbClient.send(new QueryCommand({
    TableName: LICENSES_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'customer_email = :e',
    ExpressionAttributeValues: { ':e': customerEmail },
  }));

  const licenses = queryResult.Items || [];
  await Promise.all(licenses.map(license =>
    ddbClient.send(new UpdateCommand({
      TableName: LICENSES_TABLE,
      Key: { license_token: license.license_token },
      UpdateExpression: 'SET #s = :s, updated_at = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'inactive',
        ':u': new Date().toISOString(),
      },
    }))
  ));

  console.log(`[Webhook] Deactivated ${licenses.length} license(s) for ${customerEmail}`);
}
