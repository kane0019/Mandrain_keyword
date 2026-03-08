# Mandrain 后端服务架构设计（AWS）

## 一、总体架构

```
Chrome Extension
      │
      ▼
API Gateway (REST)
      │
      ├── POST /api/v1/session/init
      │         │
      │         ▼
      │   Lambda: session-init
      │         │
      │         ├── DynamoDB: devices 表（设备登记 + 3台上限校验）
      │         ├── DynamoDB: licenses 表（token 验证 + 订阅状态）
      │         └── 返回: access_token (JWT, 1h有效期)
      │
      └── POST /api/v1/analyze
                │
                ▼
          Lambda: analyze
                │
                ├── DynamoDB: word_cache 表（热词缓存，TTL 24h）
                ├── 未命中 → 调用 Bedrock / OpenAI 进行语义解析
                └── 返回: zh, en, definition, implication, sentiment, source
```

## 二、AWS 服务选型

| 组件           | AWS 服务                  | 说明                                    |
|---------------|--------------------------|----------------------------------------|
| API 网关       | API Gateway (REST)       | 路由、限流、CORS、API Key 管理            |
| 计算层         | Lambda (Node.js 20.x)   | 无服务器，按次计费，冷启动 <200ms          |
| 数据库         | DynamoDB                 | 按需模式，毫秒级响应，3 张表               |
| AI 解析        | Bedrock (Claude)         | 语义分析，按 token 计费                   |
| 鉴权           | JWT (自签)               | Lambda 内校验，不依赖 Cognito             |
| 密钥管理       | Secrets Manager          | 存储 JWT 签名密钥、AI API Key            |
| 日志监控       | CloudWatch               | Lambda 日志 + 自定义指标 + 告警           |
| CDN (可选)     | CloudFront               | 如需全球加速可前置                        |

## 三、DynamoDB 表设计

### 3.1 licenses 表 — 许可证管理

```
Table: mandrain-licenses
PK: license_token (S)

Attributes:
  plan          (S)    — free / pro / enterprise
  status        (S)    — active / inactive / expired
  max_devices   (N)    — 设备上限，free=1, pro=3, enterprise=10
  created_at    (S)    — ISO 8601
  expires_at    (S)    — 订阅到期时间
  email         (S)    — 关联邮箱（可选）
```

### 3.2 devices 表 — 设备登记

```
Table: mandrain-devices
PK: license_token (S)
SK: install_id (S)

Attributes:
  platform       (S)   — Win32 / MacIntel / Linux
  client_version (S)   — 插件版本号
  first_seen     (S)   — 首次登记时间
  last_seen      (S)   — 最后活跃时间
  is_active      (BOOL) — 是否活跃

GSI: 无（通过 Query PK 获取某 token 下所有设备）
```

### 3.3 word_cache 表 — 云端解析缓存

```
Table: mandrain-word-cache
PK: text (S)          — 查询词汇
SK: lang (S)          — 语言标识 (zh)

Attributes:
  zh             (S)
  en             (S)
  definition     (S)
  implication    (S)
  sentiment      (S)
  source         (S)   — cloud
  ttl            (N)   — Unix timestamp, DynamoDB TTL 自动过期 (24h)
```

## 四、Lambda 函数设计

### 4.1 session-init

```
触发: API Gateway POST /api/v1/session/init
超时: 5s
内存: 256MB

流程:
  1. 解析入参: license_token, install_id, client_version, platform
  2. 查 licenses 表 → 验证 token 有效性 + 订阅状态
     - 不存在 → 返回 401 TOKEN_INVALID
     - status != active → 返回 401 SUBSCRIPTION_INACTIVE
     - 已过期 → 返回 401 SUBSCRIPTION_INACTIVE
  3. 查 devices 表 → Count(PK=license_token, is_active=true)
     - Count >= max_devices 且 install_id 不在已登记列表 → 返回 403 DEVICE_LIMIT_EXCEEDED
  4. 写入/更新 devices 表 (PK=token, SK=install_id)
  5. 签发 JWT access_token
     - payload: { sub: install_id, plan: plan, iat, exp: now+3600 }
     - 签名密钥从 Secrets Manager 获取（Lambda 启动时缓存）
  6. 返回: access_token, expires_in, plan, device_count, max_devices, feature_flags
```

### 4.2 analyze

```
触发: API Gateway POST /api/v1/analyze
超时: 10s
内存: 512MB

流程:
  1. 校验 Authorization header → 解码 JWT → 验签 + 过期检查
     - 无效 → 返回 401 UNAUTHORIZED
  2. 解析入参: text, prefix, suffix, page_url, lang
     - text 为空 → 返回 400 EMPTY_TEXT
  3. 查 word_cache 表 (PK=text, SK=lang)
     - 命中 → 直接返回缓存结果
  4. 未命中 → 调用 Bedrock Claude API
     Prompt 模板:
     ───────────────────────────────────────
     你是中文语义分析专家。请分析以下词汇在上下文中的含义。

     词汇: {text}
     前文: {prefix}
     后文: {suffix}
     来源页面: {page_url}

     请以 JSON 格式返回:
     - zh: 中文原词
     - en: 英文翻译
     - definition: 字面释义（英文）
     - implication: 潜台词/深层含义（英文）
     - sentiment: 情绪色彩 (positive/negative/neutral)
     ───────────────────────────────────────
  5. 解析 AI 返回 → 写入 word_cache 表 (TTL = 24h)
  6. 返回结果
```

## 五、API Gateway 配置

```yaml
路由:
  POST /api/v1/session/init  → Lambda: session-init
  POST /api/v1/analyze       → Lambda: analyze

CORS:
  Allow-Origin: *
  Allow-Headers: Content-Type, Authorization, X-Install-Id, X-Mandrain-Version
  Allow-Methods: POST, OPTIONS

限流 (Usage Plan):
  Free plan:  10 次/分钟,  200 次/天
  Pro plan:  100 次/分钟, 5000 次/天

API Key: 不使用（鉴权由 JWT 完成）
```

## 六、安全设计

| 层级       | 措施                                          |
|-----------|----------------------------------------------|
| 传输层     | HTTPS only (API Gateway 默认)                 |
| 鉴权层     | JWT 签名校验 + 过期检查                         |
| 设备层     | install_id 绑定 + 设备上限                     |
| 数据层     | DynamoDB 加密（默认 AWS 托管密钥）              |
| 密钥层     | JWT 密钥存 Secrets Manager，Lambda 运行时读取   |
| 限流层     | API Gateway Usage Plan + Lambda 并发限制        |
| 输入校验   | Lambda 内对所有入参做类型和长度校验              |

## 七、成本估算（月）

基于 1000 活跃用户，每人每天 50 次查询假设：

| 服务              | 用量                    | 估算费用      |
|------------------|------------------------|--------------|
| API Gateway      | 1.5M 请求/月            | ~$5          |
| Lambda           | 1.5M 次, 平均 200ms    | ~$3          |
| DynamoDB         | 按需模式, <1GB 存储      | ~$2          |
| Bedrock (Claude) | ~50K 次 AI 调用 (缓存后) | ~$15-40      |
| Secrets Manager  | 2 个密钥               | ~$1          |
| CloudWatch       | 日志 + 指标              | ~$2          |
| **合计**          |                        | **~$28-53**  |

## 八、部署方案

推荐使用 AWS SAM (Serverless Application Model):

```
backend/
├── template.yaml          ← SAM 模板（定义所有资源）
├── src/
│   ├── session-init/
│   │   └── index.mjs      ← session/init Lambda
│   └── analyze/
│       └── index.mjs      ← analyze Lambda
├── package.json
└── samconfig.toml          ← 部署配置
```

部署命令:
```bash
sam build
sam deploy --guided         # 首次部署（交互式配置）
sam deploy                  # 后续部署
```

## 九、后续扩展点

1. **用户管理** — 加 Cognito User Pool，支持邮箱注册/登录
2. **支付集成** — Stripe Webhook → Lambda 更新 licenses 表
3. **词库管理** — 管理后台 (S3 + CloudFront 托管前端) 批量导入/导出词条
4. **分析统计** — Kinesis Data Firehose → S3 → Athena，查询用户行为数据
5. **多语言** — analyze Lambda 的 lang 参数扩展到 ja/ko/en
