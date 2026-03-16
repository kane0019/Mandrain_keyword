# Lemon Squeezy Webhook Setup Guide

## 1. AWS Secrets Manager

After deploying the secrets stack, set the actual signing secret value:

```bash
# Test mode
aws secretsmanager update-secret \
  --secret-id mandrain-ls-webhook-secret-dev \
  --secret-string "test-2026"

# Production
aws secretsmanager update-secret \
  --secret-id mandrain-ls-webhook-secret-prod \
  --secret-string "<your-live-signing-secret>"
```

The signing secret is displayed once when you create the webhook in the LS dashboard.

---

## 2. Lemon Squeezy Dashboard

### Webhook URL

Get the endpoint from CloudFormation after deployment:

```bash
aws cloudformation describe-stacks \
  --stack-name mandrain-extension-apigateway-dev \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookEndpoint'].OutputValue" \
  --output text
```

URL format: `https://<api-id>.execute-api.<region>.amazonaws.com/v1/api/v1/webhook`

### Dashboard Path

**Store Dashboard → Settings → Webhooks → Add webhook**

| Field | Value |
|---|---|
| URL | (output from above) |
| Signing secret | `test-2026` (test) / live secret (prod) |
| Events | See below |

### Events to Subscribe

| Event | Purpose |
|---|---|
| `license_key_created` | Initial license record creation on purchase |
| `subscription_created` | Detect trial period start (`status: on_trial`) |
| `subscription_updated` | Handle renewals, cancellations, trial end |
| `subscription_expired` | Hard-deactivate license |

---

## 3. LS Account / Product IDs

| Field | Value |
|---|---|
| Store ID | `314613` |
| Product ID | `888449` |
| Variant ID (Pro monthly) | `1398402` |

These are baked into `cfn-lambda.yaml` env vars (`LS_STORE_ID`, `LS_VARIANT_PLAN_MAP`).  
If you add new variants (e.g. annual plan), update `LS_VARIANT_PLAN_MAP` in the Lambda stack:

```
LS_VARIANT_PLAN_MAP = '{"1398402":"pro","<new-variant-id>":"pro"}'
```

---

## 4. Trial Period Behavior

LS sends a `subscription_created` event with `status: "on_trial"` and a `trial_ends_at` timestamp.  
The webhook Lambda stores this as:

```
status: active
expires_at: <trial_ends_at>
```

When the trial ends LS fires `subscription_updated` with `status: "expired"` → Lambda sets `status: inactive`.

---

## 5. Test Mode vs Live Mode

- LS test mode webhooks **only fire for test mode purchases** (pay with test card `4242 4242 4242 4242`).
- Test mode and live mode use **separate signing secrets**.
- The Lambda verifies `store_id` in the payload matches `LS_STORE_ID` env var to reject cross-store events.

To switch to production:
1. Create a **live mode** webhook in LS dashboard with the live signing secret.
2. Update Secrets Manager (`mandrain-ls-webhook-secret-prod`) with the live secret.
3. Deploy to the `prod` environment via `workflow_dispatch` → `prod`.

---

## 6. Deployment Order

Stacks must deploy in this order (handled automatically by `deployment.yml`):

```
DynamoDB  ──┐
            ├──► Lambda ──► API Gateway
Secrets   ──┘
```

Lambda imports `LsWebhookSecretArn` from the Secrets stack via `Fn::ImportValue`.  
If the Secrets stack is not deployed first, Lambda stack will fail.

---

## 7. Verify Webhook is Working

After deployment, send a test event from LS Dashboard → Webhooks → your webhook → **Send test**.

Check Lambda logs:

```bash
aws logs tail /aws/lambda/mandrain-ls-webhook-dev --follow
```

Expected log on valid request: `[ls-webhook] Processed license_key_created for <email>`  
On signature failure: `[ls-webhook] Invalid signature` (returns HTTP 401)
