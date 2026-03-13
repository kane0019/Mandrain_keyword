# Mandrain Keyword — Project Progress

> Last updated: 2026-03-13

## What It Does

Chrome Manifest V3 extension that provides **culture-aware semantic analysis** for Chinese text. When a user highlights a word on any webpage, it shows:

- **字面意 (Definition)** — literal meaning in English
- **潜台词 (Implication)** — subtext, slang, cultural context
- **情绪色彩 (Sentiment)** — positive / negative / neutral

The core value proposition: decode modern Chinese internet slang (内卷, 躺平, PUA, etc.), sarcasm, and social context that standard translation tools miss.

---

## Architecture

```
Chrome Extension (MV3)
  ├─ content_script.js  — DOM selection listener, Shadow DOM cards
  ├─ background.js      — Service worker, local dict, cloud API calls
  ├─ popup.html/js      — Settings (token, blacklist)
  └─ local_db.json      — Offline dictionary (currently 10 entries)

                    │ HTTP
                    ▼

AWS Backend
  ├─ API Gateway (REST)       → POST /api/v1/session/init
  │                            → POST /api/v1/analyze (29s limit)
  ├─ Lambda: session-init      → JWT issuing, license validation, device registration
  ├─ Lambda: analyze           → Cache lookup + model invocation (sync, 60s)
  ├─ Lambda: analyze-stream    → Same logic, NDJSON streaming (120s)
  │   └─ Function URL          → RESPONSE_STREAM mode (bypasses API GW 29s)
  ├─ DynamoDB                  → licenses, devices, word_cache (24h TTL)
  ├─ Bedrock                   → DeepSeek v3.2 (primary), Nova Pro (fallback)
  ├─ VPC + NAT Gateway         → Lambda isolation, Bedrock access
  └─ Secrets Manager           → JWT signing key
```

---

## 3-Tier Caching Strategy

| Tier | Location | Speed | Cost | Coverage |
|------|----------|-------|------|----------|
| **1. Local Dict** | Extension memory | < 1ms | $0 | 10 entries (need 100+) |
| **2. DynamoDB Cache** | Server-side, shared | 10-50ms | ~$0 | Grows with usage, 24h TTL |
| **3. Model Analysis** | Bedrock (DeepSeek/Nova) | 2-55s | $$$ | Novel terms only |

**Goal**: Tier 1 handles 90% of queries. Tier 2 catches the long tail. Tier 3 fires only for truly novel terms (~5-10%).

---

## Freemium Model (Server-Side Gate)

| Capability | Free | Pro |
|---|---|---|
| Local dictionary | ✅ same for all | ✅ same for all |
| DynamoDB cache reads | ✅ shared pool | ✅ shared pool |
| AI model analysis | ❌ `UPGRADE_REQUIRED` | ✅ DeepSeek + Nova |
| Streaming progress | N/A | ✅ real-time NDJSON |

**Gate location**: Lambda checks `jwtPayload.plan` after cache miss. Free users on cache miss see an **"Upgrade to Pro"** upsell card instead of a model call. No client-side dict protection needed — the paywall lives at the API layer.

---

## Streaming Architecture

Two API paths for the analyze endpoint:

**Path A — API Gateway (sync)**: Standard JSON response. 29s hard limit. DeepSeek can timeout.

**Path B — Lambda Function URL (streaming, preferred)**:
- `InvokeMode: RESPONSE_STREAM`
- NDJSON events: `status → analyzing → thinking (heartbeat 5s) → result`
- 120s timeout, no API GW bottleneck
- Client sees immediate loading card with live status updates

---

## Test & Eval System

**`test/eval_model.sh`** — 47 test cases across 8 categories:

| Category | Count | What it tests |
|---|---|---|
| A — Network slang | 8 | Common terms with clean context |
| B — Irony/subtext | 4 | Sarcasm, double meaning |
| C — Emotional expression | 4 | Tone, attitude words |
| D — Social phenomena | 4 | Cultural terms |
| E — Full sentences | 3 | No word isolation, whole sentence |
| N — Noisy real-world context | 9 | Weibo, Zhihu, news, WeChat noise |
| M — No/minimal context | 8 | Bare words, no prefix/suffix |
| L — Literal vs slang | 6 | Same word, different meaning by context |

**Scoring**: Structure check (fields exist) + Keyword accuracy check (expected words in response).

**Last run results** (46 cases processed):
- PASS: 42 (100% accuracy on responded cases)
- INCOMPLETE: 4 (API Gateway timeout — DeepSeek exceeded 29s)

**`test/generate_local_db.sh`** — Batch generates ~110 local dict entries via model API.

---

## Current Status

### ✅ Done

- Chrome extension: selection detection, 200-char context extraction, Shadow DOM cards
- Three card types: results card, loading/streaming card, upgrade upsell card
- Backend Lambdas: session-init, analyze (sync), analyze-stream (NDJSON)
- DynamoDB schema: licenses, devices, word_cache with TTL
- JWT auth: issuance, verification, 1h expiry, auto-refresh
- CloudFormation templates: VPC, DynamoDB, Lambda, API Gateway
- Model strategy: DeepSeek primary (streaming) → Nova Pro fallback (sync)
- Free/Pro plan gating at API level (`UPGRADE_REQUIRED` on cache miss for free users)
- Cache model field returned on cache hits
- Streaming progress: loading card → status updates → result card
- Eval suite: 47 cases, keyword accuracy validation, per-category reporting
- Site blacklist: per-domain disable with popup management
- Error handling: TOKEN_INVALID, SUBSCRIPTION_INACTIVE, DEVICE_LIMIT_EXCEEDED, TEXT_TOO_LONG, UPGRADE_REQUIRED

### ⚠️ Pending

| Item | Priority | Notes |
|------|----------|-------|
| **Populate local_db.json** | P0 | Run `generate_local_db.sh` — 10 entries → 100+ |
| **Deploy to AWS** | P0 | CFN templates ready, need account + credentials |
| **Enable streaming URL** | P0 | Set `ANALYZE_STREAM_URL` in background.js after deploy |
| **Payment integration** | P1 | Stripe, registration page, license token generation |
| **CloudWatch monitoring** | P1 | Dashboard: error rates, latency, cache hit % |
| **Production VPC** | P2 | Multi-AZ NAT Gateway for high availability |
| **Multi-language support** | P2 | Extend to ja, ko via `lang` parameter |
| **Chrome Web Store submission** | P1 | Screenshots, privacy policy, manifest review |

---

## Key Metrics (From Last Eval Run)

| Metric | Value |
|---|---|
| Total test cases | 47 |
| Accuracy (on responded) | 100% |
| Timeout rate | 8.7% (4/46 — DeepSeek via API GW) |
| Model used | DeepSeek v3.2 (primary) |
| Local dict entries | 10 (target: 100+) |
| Extension package size | < 500KB |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome MV3, Vanilla JS, Shadow DOM |
| Backend | AWS Lambda (Node.js 20.x), API Gateway REST |
| Database | DynamoDB (on-demand, 3 tables) |
| AI | AWS Bedrock (DeepSeek v3.2, Amazon Nova Pro) |
| Auth | JWT (HS256, `jose` library) |
| Infra | CloudFormation (4 YAML templates), VPC, S3, Secrets Manager |
| Testing | Bash eval scripts, PowerShell mock server |
