# 开发与调试指南

## 环境准备

### 系统要求
- Windows 10+ / macOS 10.14+ / Linux
- Chrome 88+ （支持 Manifest V3）
- 代码编辑器（VS Code 推荐）

### 不需要额外依赖
本项目无需 Node.js、npm 或任何构建工具，使用原生 JavaScript 编写，可直接调试。

---

## 开发工作流

### 步骤1：加载扩展到开发环境

1. 打开 Chrome：`chrome://extensions/`
2. 启用右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `Mandrain_keyword/` 目录
5. 看到扩展卡片后，记下扩展ID（后续API调用可用）

### 步骤2：打开调试工具

#### Content Script 调试
```bash
# 方式1：页面内调试
打开任意网页 → F12 → Console
# 会看到 [Mandrain] 开头的日志信息
```

#### Service Worker 调试  
```bash
# 在 chrome://extensions 中
1. 找到 Mandrain 扩展卡片
2. 点击 "Details"（详情）
3. 下拉找到 "Inspect views" 
4. 点击 "service_worker" 打开调试控制台
```

#### Popup 页面调试
```bash
# 方式1：直接打开popup.html
右键点击扩展图标 → "检查弹出窗口"

# 方式2：在Chrome扩展页面调试
chrome://extensions → Mandrain → 详情 → 
"Manage extension" → 点击popup链接
```

---

## 代码修改与热更新

### 修改 Content Script（content_script.js）

修改后需要重新加载扩展：

1. 修改代码
2. 到 `chrome://extensions/` 
3. 找到 Mandrain，点击刷新按钮 🔄
4. 重新打开网页或刷新当前网页
5. 再试一次划词功能

### 修改 Service Worker（background.js）

1. 修改代码
2. 到 `chrome://extensions/` 
3. 找到 Mandrain，点击刷新按钮 🔄
4. 打开调试控制台查看是否有错误
5. 在页面上触发相关操作

### 修改 Popup（popup.html / popup.js）

1. 修改代码
2. 到 `chrome://extensions/` 
3. 找到 Mandrain，点击刷新按钮 🔄
4. 点击扩展图标查看新效果

### 修改本地词库（local_db.json）

1. 修改JSON文件
2. 到 `chrome://extensions/` 
3. 找到 Mandrain，点击刷新按钮 🔄
4. **无需页面刷新**，Service Worker会自动重新加载词库

> 💡 **小技巧**：在需要频繁修改时，建议使用 VS Code 的 Auto Save，然后直接点击扩展刷新按钮。

---

## 常见调试场景

### 场景1：划词后没有卡片出现

**排查步骤：**

1. 打开任意网页，打开F12 Console
2. 手动输入测试（检查事件监听是否工作）：
   ```javascript
   // 在console中执行
   window.getSelection().toString() // 应返回选中的文本
   ```

3. 检查日志：
   - 应该能看到 `[Mandrain]` 开头的日志
   - 如果看不到，说明 content_script 未正常加载

4. 检查Service Worker（`chrome://extensions` → Mandrain → Inspect → service_worker）：
   - 是否有 `Error` 或 `Exception`

### 场景2：查询失败，显示降级提示

**排查步骤：**

1. 检查词库是否加载：
   ```javascript
   // 在Service Worker console中执行
   console.log(localDB) // 应该显示词库对象
   ```

2. 测试本地词库查询：
   ```javascript
   // 在Service Worker console中执行
   chrome.runtime.sendMessage(
     { action: 'queryWord', word: '赋能', context: {} },
     (response) => console.log(response)
   )
   ```

3. 如果显示 `source: 'fallback'`，说明本地词库未命中且API也失败
   - 检查API地址是否正确（manifest.json 中的 host_permissions）
   - 检查API是否可访问（网络连接）

### 场景3：卡片样式混乱或被原网页CSS污染

**排查步骤：**

1. 检查Shadow DOM是否正确创建：
   ```javascript
   // 在页面Console中执行
   document.querySelector('#mandrain-card-container')?.shadowRoot
   // 应该返回 ShadowRoot 对象
   ```

2. 如果Shadow DOM未创建：
   - 检查 `renderCard()` 是否被调用
   - 检查 `attachShadow()` 是否成功（需要mode='open'）

3. 如果样式仍被污染：
   - 调整 `style.textContent` 中的样式，增加更多 `!important` 规则
   - 使用更具体的选择器

### 场景4：生词本无法保存

**排查步骤：**

1. 检查权限：
   - manifest.json 已声明 permissions 中包含... （无需特殊权限，默认支持）

2. 测试存储API：
   ```javascript
   // 在Service Worker console中执行
   chrome.storage.local.set({ test: 'hello' }, () => {
     chrome.storage.local.get(['test'], (result) => {
       console.log(result) // 应显示 { test: 'hello' }
     })
   })
   ```

3. 检查保存的数据：
   ```
   chrome://extensions → Mandrain → 详情 → 存储空间 → 本地存储
   ```

---

## 网络请求测试

### 测试云端API（模拟）

创建一个简单的测试服务器：

```javascript
// Node.js 示例（可选）
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        word: 'test',
        literal: '字面意测试',
        implication: '潜台词测试',
        sentiment: '正面'
      }));
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3000, () => console.log('Test server running on :3000'));
```

然后修改 background.js：
```javascript
const API_ENDPOINT = 'http://localhost:3000/v1/analyze';
```

### 模拟超时

在 Service Worker console 中：
```javascript
// 改变超时时间为更短的值便于测试
// 编辑 background.js，将 TIMEOUT_MS 改为 500
```

### 测试网络降级

关闭网络（离线模式）后进行划词，应该显示降级提示。

---

## 性能调试

### 内存泄漏检查

1. 打开 Chrome DevTools → Performance → Memory
2. 连续划词10次
3. 强制垃圾回收（⊜ 图标）
4. 内存应该保持稳定，不应持续增长

### Shadow DOM隔离验证

1. 打开任意网页的 DevTools
2. 划词出现卡片
3. 在 Console 中执行：
   ```javascript
   // 应该返回 ShadowRoot
   document.querySelector('#mandrain-card-container').shadowRoot
   // 查看其中的样式是否未被外部CSS影响
   ```

---

## 打包与发布

### 创建扩展包

```bash
# Windows PowerShell
Compress-Archive -Path Mandrain_keyword -DestinationPath mandrain_v1.0.0.zip

# macOS/Linux
zip -r mandrain_v1.0.0.zip Mandrain_keyword/
```

### 发布到Chrome Web Store

1. 访问 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)
2. 上传 .zip 文件
3. 填写描述、截图、类别等信息
4. 提交审核

> ⚠️ 注意：企业应用可能需要额外的隐私政策和权限审批。

---

## 常见错误与解决

| 错误 | 原因 | 解决 |
|-----|------|------|
| `Uncaught SyntaxError` | JavaScript语法错误 | 检查代码中的括号、引号 |
| `fetch() blocked by CORS` | API跨域问题 | Service Worker发起请求，不受CORS限制 |
| `chrome is not defined` | 环境不是扩展环境 | 确保代码运行在content/background环境 |
| `Cannot attach shadow to div` | Shadow DOM模式错误 | 确保 `attachShadow({ mode: 'open' })` |
| `storage is undefined` | 权限未声明 | manifest.json + 需要重新加载 |

---

## 提交代码前检查清单

- [ ] 修改了 local_db.json 但未更新云端API地址
- [ ] 日志中有 console.log / console.warn 已清理
- [ ] 敏感信息（token、API密钥）已隐藏
- [ ] 所有新功能都在至少两个浏览器标签页测试过
- [ ] 生词本保存功能正常
- [ ] 网络超时降级正常显示
- [ ] 卡片销毁无内存泄漏（连续划词>50次无性能下降）

---

## 获取帮助

遇到问题？

1. **检查Chrome 版本**：`chrome://version` 应≥88
2. **查看权限**：`chrome://permissions` 
3. **清除缓存**：`chrome://settings/clearBrowserData`
4. **重新加载**：`chrome://extensions` → 刷新按钮
5. **查看错误**：Service Worker console（上面有"Errors"链接）

