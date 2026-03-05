# 词汇智能解析助手 (Mandrain Keyword)

## 项目概述

这是一个基于 **Chrome Manifest V3** 标准构建的浏览器扩展，核心功能为：**智能划词解析**。通过识别用户划取的词汇，结合本地高频词库和云端大模型推理，为用户展示词汇的"字面意、潜台词、情绪色彩"等多维度理解。

### 核心特性
- 🎯 **本地优先** - O(1)内存查询，秒速响应
- ☁️ **云端兜底** - 本地未命中自动降级至API
- ⚡ **超时熔断** - 2000ms网络容灾机制
- 🛡️ **沙盒隔离** - Shadow DOM防CSS污染
- 💾 **生词本** - 保存感兴趣的词汇
- 🎨 **极简UI** - KB级体积，企业级简洁设计

---

## 项目结构

```
Mandrain_keyword/
├── manifest.json           # 扩展配置（V3标准）
├── content_script.js       # DOM操作层：事件监听、UI注入
├── background.js           # Service Worker：网络请求、词库查询
├── local_db.json           # 离线词库（约100+示例词条）
├── styles.css              # 卡片样式（可选）
├── README.md               # 本文档
└── images/                 # 图标目录（16x16, 48x48, 128x128）
```

### 模块职责

#### 1️⃣ `manifest.json` - 配置中心
- 声明扩展权限（最小化原则：仅`activeTab`、`scripting`）
- 注册`content_script`和`service_worker`
- 配置资源访问权限（`local_db.json`、`styles.css`）

#### 2️⃣ `content_script.js` - DOM操作层
| 功能 | 实现 |
|-----|------|
| 事件监听 | `mouseup` + 快捷键 (Ctrl+/) |
| 上下文提取 | 前后200字符语义上下文 |
| UI注入 | 使用Shadow DOM隔离，防止原页面CSS污染 |
| 交互处理 | 保存、复制、Esc/外部点击销毁 |

#### 3️⃣ `background.js` - Service Worker
| 功能 | 实现 |
|-----|------|
| 本地查询 | O(1)时间复杂度哈希匹配 |
| 云端请求 | fetch API + 2000ms超时控制 |
| 降级处理 | 网络失败时展示优雅降级提示 |
| 生词本管理 | `chrome.storage.local` 本地存储 |

#### 4️⃣ `local_db.json` - 离线词库
- JSON格式，包含约100+高频商业词汇
- 结构：`{word} → {字面意, 潜台词, 情绪色彩, 示例}`
- 随扩展安装，无需网络即可查询

---

## 工作流程

```
┌─────────────────┐
│  用户划词/Ctrl+/  │
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ content_script.js    │
│ 1. 捕获选中词汇      │
│ 2. 提取200字符上下文 │
└────────┬─────────────┘
         │
         ▼
┌───────────────────────────┐
│  background.js (本地查询)  │ ◄─── O(1)查询
│  词库中命中?              │
└────────┬──────────────────┘
         │ NO
         ▼
┌──────────────────────────┐
│ background.js (API请求)  │ ◄─── 2000ms超时
│ 云端推理                │
│ 成功? ┬─ YES ───┐       │
│       └─ TIMEOUT┤       │
└────────┬────────┴─┬──────┘
         │          │
         ▼ YES      ▼ NO/超时
    返回数据    优雅降级提示
         │          │
         └────┬─────┘
              ▼
         ┌──────────────┐
         │ content UI   │
         │ 在鼠标位置   │
         │ 注入卡片     │
         └──────┬───────┘
                │
         ┌──────+──────────┐
         │   用户交互       │
         ├─ 关闭 (Esc)     │
         ├─ 外部点击销毁   │
         ├─ 保存到生词本   │
         └─ 复制到剪贴板   │
```

---

## 快速启动

### 1. 加载扩展到Chrome

1. 打开 `chrome://extensions/`
2. 启用右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目根目录 `Mandrain_keyword/`
5. 完成！🎉

### 2. 测试功能

1. 打开任意网页（如Wikipedia、新闻网站）
2. 划选一个词汇（如"赋能"、"破局"）
3. 卡片应在鼠标位置下方出现
4. 点击"保存"将词条存到生词本（可在 `chrome://extensions` → Mandrain详情 → 存储 查看）

### 3. 调试

- 右键扩展图标 → **检查弹出窗口** - 调试content script
- `chrome://extensions` → Mandrain → **Errors** - 查看Service Worker错误
- 浏览器控制台 (F12) - 查看content script的console输出

---

## 云端API对接

当前 `background.js` 中的API端点为示例：
```javascript
const API_ENDPOINT = 'https://api.example.com/v1/analyze';
```

### 替换为真实API步骤

1. 修改 `background.js` 中的 `API_ENDPOINT`
2. 调整请求Payload结构（如需要认证token）
3. 解析API响应格式（需返回 `{literal, implication, sentiment}` 结构）

### API请求格式

**POST** `/v1/analyze`

**请求体：**
```json
{
  "word": "赋能",
  "context": "这次改革赋能全体员工更多的创新空间。",
  "prefix": "...前200字符...",
  "suffix": "...后200字符...",
  "timestamp": "2026-03-05T10:30:00Z"
}
```

**响应格式：**
```json
{
  "word": "赋能",
  "literal": "字面意解释",
  "implication": "潜台词含义",
  "sentiment": "正面|中性|负面"
}
```

---

## 网络容灾配置

### 超时阈值

修改 `background.js` 中的常量：
```javascript
const TIMEOUT_MS = 2000; // 毫秒
```

### 降级提示文案

修改 `generateFallback()` 函数返回的 `message` 字段。

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

## 扩展与定制

### 添加新词条到本地词库

编辑 `local_db.json`：
```json
{
  "新词汇": {
    "word": "新词汇",
    "literal": "字面意义",
    "implication": "潜台词",
    "sentiment": "正面/中性/负面",
    "examples": ["例句1", "例句2"]
  }
}
```

### 自定义卡片样式

修改 `content_script.js` 中 `renderCard()` 函数内的 `style.textContent`。

### 添加新的快捷键

修改 `content_script.js` 中的快捷键检测：
```javascript
if ((event.ctrlKey || event.metaKey) && event.key === '/') {
  // 改为其他快捷键
}
```

---

## 常见问题

### Q: 为什么选择Shadow DOM？
**A:** Shadow DOM 完全隔离样式，防止原网页CSS（如Bootstrap）对卡片的污染。这是Manifest V3推荐的最佳实践。

### Q: 为什么是2000ms超时？
**A:** 在企业网络环境中，2000ms是云端请求的平衡点。太短易误杀；太长影响交互体验。

### Q: 本地词库为什么随包分发？
**A:** 确保离线可用和快速响应，不依赖网络。减少云端请求压力。

### Q: 如何保证用户隐私？
**A:** 
- 仅在用户主动划词时发送数据
- 上下文信息仅用于API推理，不存储
- 生词本存储在本地（`chrome.storage.local`）

---

## 安全与审查

✅ **Manifest V3 合规**
- 无`eval()`、动态脚本执行
- 内容安全策略(CSP)支持
- 严格权限最小化

✅ **企业安全友好**
- Shadow DOM隔离，无DOM污染
- Service Worker不受CSP/CORS限制，穿透复杂网络
- 超时和降级机制，不影响原网页性能

---

## 许可证

MIT License

---

## 更新日志

### v1.0.0 (2026-03-05)
- ✨ 初始版本发布
- 支持本地词库 + 云端降级
- Shadow DOM UI隔离
- 生词本存储功能
