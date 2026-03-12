# 词汇智能解析助手 (Mandrain Keyword)

## 项目概述

基于 **Chrome Manifest V3** 的浏览器扩展，核心功能为**智能划词解析**。帮助中文非母语用户理解词汇的"字面意、潜台词、情绪色彩"——这是普通翻译工具无法提供的文化解码能力。

### 核心特性
- 🎯 **本地优先** — O(1)哈希查询，秒速响应
- ☁️ **云端兜底** — 本地未命中自动调用云端 AI 解析
- 🔐 **会话鉴权** — session/init + JWT access_token，支持免费/付费双模式
- 📱 **设备管控** — 单账户最多 3 台设备，服务端校验
- ⚡ **超时熔断** — 2000ms 云端超时 + 优雅降级
- 🛡️ **沙盒隔离** — Shadow DOM 防 CSS 污染
- 🚫 **站点黑名单** — 卡片内一键停用当前站点，popup 管理恢复
- 📋 **复制到剪贴板** — 一键复制解析结果
- 🎨 **极简UI** — KB级体积，企业级简洁设计

---

## 项目结构

```
Mandrain_keyword/
├── extension/                # Chrome 扩展（加载插件时指向此目录）
│   ├── manifest.json         # MV3 配置
│   ├── background.js         # Service Worker：鉴权、词库查询、云端API
│   ├── content_script.js     # DOM层：划词监听、上下文提取、Shadow DOM卡片
│   ├── popup.html            # 设置页：Token管理、黑名单管理
│   ├── popup.js              # 设置页交互逻辑
│   ├── local_db.json         # 离线词库（10条示例词条）
│   └── images/               # 图标 (16/48/128)
├── backend/                  # 后端服务
│   ├── ARCHITECTURE.md       # AWS 架构设计文档
│   ├── package.json          # 依赖：jose + @aws-sdk/*
│   ├── cfn-vpc-s3.yaml       # CloudFormation: VPC + S3
│   ├── cfn-dynamodb.yaml     # CloudFormation: DynamoDB 3张表
│   ├── cfn-lambda.yaml       # CloudFormation: Lambda + IAM
│   ├── cfn-apigateway.yaml   # CloudFormation: API Gateway
│   └── src/
│       ├── shared/
│       │   ├── jwt.mjs       # JWT 签发/验证 + Secrets Manager 缓存
│       │   └── response.mjs  # CORS 响应 + JSON 解析
│       ├── session-init/
│       │   └── index.mjs     # 会话初始化 Lambda
│       └── analyze/
│           └── index.mjs     # 词汇分析 Lambda
├── test/                     # 测试工具
│   └── mock_server.ps1       # PowerShell 本地 mock server（零依赖）
├── README.md
├── DEVELOPMENT.md
└── QUICKSTART.html
```

---

## 已实现功能

### 插件端

| 功能 | 状态 | 说明 |
|------|------|------|
| 划词查询 | ✅ | mouseup 触发，选区去重，前后 200 字上下文提取 |
| 本地词库 O(1) 查询 | ✅ | 内存级哈希匹配，10 条示例词条 |
| 云端 API 调用 (analyze) | ✅ | 本地未命中时自动调用，2000ms 超时，优雅降级 |
| 会话鉴权 (session/init) | ✅ | 免费默认 token + 用户可填付费 token |
| JWT access_token 管理 | ✅ | 自动刷新过期 token，30s 缓冲 |
| 设备登记 + 3 台上限 | ✅ | install_id 绑定，DEVICE_LIMIT_EXCEEDED 错误透传 |
| Shadow DOM 卡片渲染 | ✅ | 样式隔离，展示 Definition / Implication / Sentiment |
| 差异化错误提示 | ✅ | TOKEN_INVALID / SUBSCRIPTION_INACTIVE / DEVICE_LIMIT_EXCEEDED / TEXT_TOO_LONG |
| 查询词长度限制 | ✅ | ≤30 字符，防止整句/整段滥用云端 API |
| 站点黑名单 | ✅ | 卡片内"在此站点停用"按钮，popup 管理恢复 |
| Popup 设置页 | ✅ | Token 输入/保存/重置 + 会话状态 + 黑名单管理 + 注册链接 |
| 复制到剪贴板 | ✅ | 卡片底部按钮 |
| 卡片交互 | ✅ | 关闭按钮、Esc 键、点击外部关闭 |

### API 接口规范（插件端已对接）

#### POST /api/v1/session/init
- **入参**: `license_token`, `install_id`, `client_version`, `platform`
- **成功返回**: `access_token`, `expires_in`, `plan`, `device_count`, `max_devices`, `feature_flags`
- **失败返回**: `TOKEN_INVALID` / `SUBSCRIPTION_INACTIVE` / `DEVICE_LIMIT_EXCEEDED`

#### POST /api/v1/analyze
- **请求头**: `Authorization: Bearer <access_token>` + `X-Install-Id`
- **入参**: `text`, `prefix`, `suffix`, `page_url`, `lang`
- **返回**: `zh`, `en`, `definition`, `implication`, `sentiment`, `source`

### 后端 Lambda（代码已完成，待部署）

AWS Serverless 方案，详见 `backend/ARCHITECTURE.md`。

```
backend/src/
├── shared/
│   ├── jwt.mjs          # JWT 签发/验证 + Secrets Manager 密钥缓存
│   └── response.mjs     # CORS 响应构建 + JSON 解析
├── session-init/
│   └── index.mjs        # 会话初始化 Lambda
└── analyze/
    └── index.mjs        # 词汇分析 Lambda
```

#### Lambda 1: session-init 业务流程

```
入参: license_token, install_id, client_version, platform
    │
    ▼
[入参校验] → 缺 license_token → 400 TOKEN_MISSING
    │         缺 install_id   → 400 INVALID_REQUEST
    ▼
[查 licenses 表] PK=license_token
    │
    ├─ 不存在          → 401 TOKEN_INVALID
    ├─ status≠active   → 401 SUBSCRIPTION_INACTIVE
    ├─ expires_at 过期  → 401 SUBSCRIPTION_INACTIVE
    │
    ▼
[查 devices 表] Query PK=license_token, Filter is_active=true
    │
    ├─ 活跃设备数 ≥ max_devices 且 install_id 未注册
    │   → 403 DEVICE_LIMIT_EXCEEDED (返回 device_count + max_devices)
    │
    ▼
[写入 devices 表] PutItem (license_token, install_id, platform, ...)
    │               已存在 → 更新 last_seen
    │               新设备 → 写入 first_seen + last_seen
    ▼
[签发 JWT] HS256, payload: {sub: install_id, plan, license_token}, 有效期 1h
    │       签名密钥: Secrets Manager (冷启动加载，后续内存缓存)
    ▼
返回 200: access_token, expires_in(3600), plan, device_count, max_devices,
          feature_flags: {cloud_analysis: plan≠free}
```

#### Lambda 2: analyze 业务流程

```
请求头: Authorization: Bearer <access_token>
入参:   text, prefix, suffix, page_url, lang
    │
    ▼
[JWT 验证] → 无 token → 401 TOKEN_MISSING
    │         无效/过期 → 401 TOKEN_INVALID
    ▼
[入参校验] → text 为空     → 400 EMPTY_TEXT
    │         text > 30字符 → 400 TEXT_TOO_LONG
    ▼
[查 word_cache 表] PK=text, SK=lang(默认zh)
    │
    ├─ 命中 → 直接返回 (source: "cache")
    │
    ▼ 未命中
[调用 Bedrock Claude Sonnet]
    │  Prompt: 中文语义分析专家角色
    │  输入: 词汇 + 前文 + 后文 + 来源页面
    │  要求: 返回 JSON {zh, en, definition, implication, sentiment}
    │
    ├─ AI 调用失败 → 502 AI_SERVICE_ERROR
    │
    ▼
[写入 word_cache 表] TTL = 当前时间 + 24h (DynamoDB TTL 自动清理)
    │
    ▼
返回 200: zh, en, definition, implication, sentiment, source("cloud")
```

**技术要点**：
- JWT 库使用 `jose`（轻量，无原生依赖），`@aws-sdk/*` 由 Lambda Node.js 20.x 运行时内置
- Secrets Manager 密钥在冷启动时加载一次，后续请求复用内存缓存
- Bedrock 返回内容兼容 markdown code block 包裹，正则提取 JSON
- CloudFormation 模板已就绪：`cfn-vpc-s3.yaml` → `cfn-dynamodb.yaml` → `cfn-lambda.yaml` → `cfn-apigateway.yaml`

---

## 快速启动

### 1. 启动 Mock Server（开发测试用）

```powershell
cd Mandrain_keyword/test
powershell -ExecutionPolicy Bypass -File mock_server.ps1
```

Mock server 运行在 `http://localhost:3721`，无需 Node.js 或 Python。

**测试 Token：**

| Token | 效果 |
|-------|------|
| `free-token-placeholder` | Free plan（插件默认） |
| `paid-token-test` | Pro plan，export 开启 |
| `invalid-token` | TOKEN_INVALID |
| `expired-token` | SUBSCRIPTION_INACTIVE |
| `device-limit-token` | DEVICE_LIMIT_EXCEEDED |

**云端模拟词库：** 内卷、躺平、摆烂（本地词库以外的词走此处）

### 2. 加载插件到 Chrome

1. 打开 `chrome://extensions/`
2. 启用 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `Mandrain_keyword/extension/` 目录

### 3. 测试流程

1. 划词 `赋能`（本地命中）→ 卡片秒出
2. 划词 `内卷`（云端命中）→ 卡片稍有延迟
3. 划词任意未知词 → 云端 fallback 响应
4. 点插件图标 → popup 设置页，填 `invalid-token` 等测试错误路径
5. 卡片中点"在此站点停用" → 验证黑名单功能

### 4. 调试

- 浏览器控制台 (F12) — content_script 日志（`[Mandrain]` 前缀）
- `chrome://extensions` → Mandrain → **Service Worker** — background 日志
- Mock server 终端 — 查看请求日志

---

## 测试结果（Mock Server 验证通过）

| 测试场景 | 结果 |
|----------|------|
| session/init free-token-placeholder | ✅ plan=free, devices=1/3 |
| session/init paid-token-test | ✅ plan=pro, export=true |
| session/init invalid-token | ✅ 401 TOKEN_INVALID |
| session/init expired-token | ✅ 401 SUBSCRIPTION_INACTIVE |
| session/init device-limit-token | ✅ 403 DEVICE_LIMIT_EXCEEDED |
| analyze 云端命中（内卷/躺平/摆烂） | ✅ 正确返回解析结果 |
| analyze 未命中词 | ✅ 返回 mock fallback |
| analyze 无 auth header | ✅ 401 UNAUTHORIZED |
| CORS preflight (OPTIONS) | ✅ 204 正确响应 |

---

## 配置项

修改 `extension/background.js` 中的常量：
```javascript
const API_BASE_URL = 'http://localhost:3721/api/v1'; // 生产环境替换为实际地址
const MAX_QUERY_LENGTH = 30;  // 查询词最大字符数
```

---

## 性能指标

| 指标 | 目标 | 状态 |
|-----|------|------|
| 本地词库查询 | < 1ms | ✅ |
| UI注入渲染 | < 100ms | ✅ |
| 云端API超时 | 2000ms | ✅ |
| 扩展包体积 | < 500KB | ✅ |
| Shadow DOM隔离 | 100%无污染 | ✅ |

---

## 安全

- **Manifest V3 合规** — 无 eval()、无动态脚本、CSP 支持、权限最小化
- **输入校验** — 查询词 ≤30 字符限制，防止云端 API 滥用
- **鉴权体系** — JWT access_token + install_id 双重校验
- **隐私保护** — 仅用户主动划词时发送数据，黑名单/Token 存本地

---

## 🔄 待办事项

### P2 — 后续迭代

1. **基础性能日志** — 命中率、响应延迟统计
2. **限流配置** — API Gateway Usage Plan，free/pro 不同限额
3. **手动输入查询** — popup 输入框，支持无上下文词汇查询（优先级低于划词，无上下文时精度下降且竞品替代性高）
4. **NAT Gateway 冗余** — 当前 dev/prod 均单 NAT Gateway（省成本），生产稳定后在第二个 AZ 增加 NAT + 独立路由表实现高可用
5. **冷热分层模型** — 缓存未命中时先尝试 Nova Pro（2-3s），若 implication 字段信息量不足再降级调用 DeepSeek 3.2；预期 80% 查询由 Nova Pro 处理，显著降低 P99 延迟
6. **异步预热缓存** — 用户选词后立即返回"分析中"，Lambda 后台写入 DynamoDB 缓存；需前端 polling 支持，解决 DeepSeek 首次慢的体验问题
7. **响应字段扩展** — 新增 `register`（`formal/slang/internet/literary`，判断正式场合能否使用）和 `usage_example`（英文示例句），提升产品信息密度

### P3 — 远期规划

1. **词库扩充与分层** — 核心高频词库随包，长尾词库按需加载（待词库超千条再考虑）
2. **成本控制看板** — 模型调用预算管理、缓存命中率统计
3. **快捷键功能** — 手动输入查询或快速打开生词本
4. **多语言支持** — analyze 接口 lang 参数扩展到 ja/ko/en

### 独立项目

1. **官网注册 + 支付** — 用户注册、Stripe 付费、Token 发放
2. **设备管理页** — 用户自助解绑旧设备

---

## 更新日志

### v1.1.0 (2026-03-08)
- ✨ 完成双接口对接（session/init + analyze）
- 🔐 会话鉴权体系（免费默认 token + 付费 token + JWT 刷新）
- 📱 设备登记 + 3 台上限校验 + 差异化错误提示
- 🖥️ Popup 设置页（Token 管理 + 会话状态 + 黑名单管理）
- 🚫 站点黑名单（卡片一键停用 + popup 恢复）
- 🛡️ 查询词 ≤30 字符限制（防滥用）
- 🧪 PowerShell Mock Server（零依赖本地测试）
- 📁 项目重构为 extension/ + backend/ + test/ 分层
- 📐 AWS 后端架构设计文档

### v1.0.0 (2026-03-05)
- ✨ 初始版本发布
- 支持本地词库 + 云端降级
- Shadow DOM UI隔离
- 复制到剪贴板
