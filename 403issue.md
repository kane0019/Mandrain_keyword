# 403 Error Investigation — mandrain-analyze-stream-dev

**Date:** 2026-03-14  
**Status:** ✅ RESOLVED — 端到端验证通过，Chrome 划词返回结果正常

---

## 症状

- 插件划词 → session/init 成功，正常获取 JWT token
- 进入 streaming 分析流程后，`queryCloudAPIStreaming` 收到 HTTP 403
- `background.js` 打出：`Streaming auth error, refreshing session and retrying...`
- 重试后仍然 403，最终走到 error 路径

---

## 已排除的原因

| 假设 | 排除理由 |
|------|---------|
| JWT 过期 / plan=free 被 UPGRADE_REQUIRED 拦截 | 应用层的 403 会在 NDJSON 里以 `{type:"error"}` 返回，不会走 `!resp.ok` 分支，且 streaming handler 始终发 HTTP 200 |
| Function URL AuthType 不是 NONE | `aws lambda get-function-url-config` 确认 `AuthType: NONE` |
| Lambda Permission 资源未部署 | `aws lambda get-policy` 确认 `lambda:InvokeFunctionUrl / Principal: *` 存在 |
| CloudFormation 资源漂移 | CFN 显示 CREATE_COMPLETE，但实际行为不符 |
| 代码包 ESM 格式导致 `awslambda.streamifyResponse` 初始化失败 | 已将 build 改为 CJS（`--format=cjs --outfile=dist/analyze/index.js`），重新部署 |

---

## 关键证据

```
aws logs describe-log-streams \
  --log-group-name /aws/lambda/mandrain-analyze-stream-dev \
  --region us-east-1
→ "logStreams": []
```

**Lambda 从未执行过任何一次请求**。这意味着 HTTP 403 在 Lambda 进程被调用之前就由 AWS 基础设施返回。

直接测试 Function URL（不带合法 token）：
```
Invoke-WebRequest -Uri "https://zxdddkk6qjh6zdf2afxhijnrem0wegyi.lambda-url.us-east-1.on.aws/"
→ {"Message":"Forbidden. ..."}  HTTP 403
```

Lambda 最后更新时间（CloudFormation 部署后）：`2026-03-14T07:43:xx UTC`  
S3 latest.zip 上传时间：`2026-03-14T17:37 UTC`（在 Lambda 更新之后，是一次只上传了包但 Lambda 未更新的情况）

---

## 当前假设（最可能根因）

### 假设 A：CJS bundle 里 `index.js` handler 名称不对

Lambda 配置的 handler 是 `index.streamHandler`（CJS 格式下应导出为 `exports.streamHandler`）。  
esbuild CJS 构建时，ESM 的 `export const streamHandler = ...` 会被转换为 `exports.streamHandler = ...`，理论上正确。  
但 `awslambda.streamifyResponse` 在 CJS 顶层仍然是同步执行，如果 `awslambda` 全局在模块加载时不存在，会抛 `TypeError: Cannot read properties of undefined`，Lambda 进程崩溃，**不留日志，AWS 返回 403**。

### 假设 B：`InvokeMode: RESPONSE_STREAM` 要求 handler 必须是 `awslambda.streamifyResponse` 包装的版本，但当前部署的包里没有正确导出

esbuild 打包 CJS 时，`awslambda` 是 runtime 全局，不在 npm 包里。如果 esbuild 把它当作 undefined 引用处理（tree-shake 或报 warning），会导致运行时崩溃。

### 假设 C：Lambda 的 VPC 配置导致 Function URL 无法正常工作

`AnalyzeStreamFunction` 配置了 VPC（私有子网），Lambda Function URL 在 VPC 模式下**需要特殊的网络配置**（VPC endpoint 或公网访问）才能被外部调用到 Lambda 本体。AWS 可能在 VPC 检查阶段就返回 403。

> **这是目前最可疑的假设**：session-init 也有 VPC，但它走的是 API Gateway（有自己的网络路径），而 analyze-stream 直接用 Function URL 被外部调用，VPC + Function URL 组合可能存在问题。

---

## 下一步排查计划

### Step 1：验证假设 C（VPC 问题）— 优先级最高

从 CloudFormation 模板可以看出两个 Lambda 都配置了 VPC：
```yaml
VpcConfig:
  SecurityGroupIds: [...]
  SubnetIds: [...]  # PrivateSubnetIds
```

**验证方法：** 临时创建一个不带 VPC 的测试版 Lambda，使用相同代码，看 Function URL 是否能正常响应。

或者：检查 `mandrain-analyze-stream-dev` 的实际 VPC 配置：
```powershell
aws lambda get-function-configuration \
  --function-name mandrain-analyze-stream-dev \
  --region us-east-1 \
  --query "VpcConfig"
```

### Step 2：验证假设 A/B（CJS 构建问题）

下载最新部署的包，检查 `index.js` 末尾是否有正确的 `exports.streamHandler`：
```powershell
aws s3 cp s3://mandrain-lambda-code-106500537365-dev/analyze/latest.zip latest.zip
Expand-Archive latest.zip -DestinationPath latest-analyze
Select-String "streamHandler\|streamifyResponse\|exports\." latest-analyze/index.js | Select -Last 20
```

---

## 解决过程记录

### 2026-03-14 第一阶段：确认 Lambda 从未被 invoke

- Lambda 日志组 `/aws/lambda/mandrain-analyze-stream-dev` stored=0，证实请求在到达 handler 之前就被拒绝
- 与此对比，`/aws/lambda/mandrain-analyze-dev` stored=80KB（有执行记录）
- 之前的 console test TOKEN_INVALID 结果，实际测试的是 `mandrain-analyze-dev` 而非 stream 版本

### 2026-03-14 第二阶段：定位 403 根因 — 缺少 `lambda:InvokeFunction` 权限

AWS Console 提示：
> Your function URL auth type is NONE, but is missing permissions required for public access. To allow unauthenticated requests, create a resource-based policy that grants **lambda:invokeFunction** and **lambda:invokeFunctionUrl** permissions to all principals (*).

之前 CFN 只配置了 `lambda:InvokeFunctionUrl`，缺少 `lambda:InvokeFunction`。

**修复（commit af48e1b）：** 在 `cfn-lambda.yaml` 中新增：
```yaml
AnalyzeStreamInvokePermission:
  Type: AWS::Lambda::Permission
  Properties:
    FunctionName: !GetAtt AnalyzeStreamFunction.Arn
    Action: lambda:InvokeFunction
    Principal: '*'
```

部署后 Lambda 开始被 Chrome 成功 invoke（CloudWatch 日志时间与 Chrome 触发时间吻合）✅

### 2026-03-14 第三阶段：streaming 路径错误 — `handleOnceNonStreaming`

Lambda 被 invoke 后报错：
```
TypeError: underlyingStream.setContentType is not a function
at HttpResponseStream.from (file:///var/runtime/index.mjs:1036:26)
at Runtime.handleOnceNonStreaming
```

**根因：** handler 的 export 方式不对。Lambda 运行时通过判断 handler 是否是 `streamifyResponse` 返回值来决定走 streaming 还是 non-streaming 路径。

```js
// 错误：包了一层普通函数，运行时识别为普通 handler
export function streamHandler(event, responseStream, context) {
  return awslambda.streamifyResponse(_streamHandlerImpl)(event, responseStream, context);
}

// 正确：直接 export streamifyResponse 的返回值
export const streamHandler = awslambda.streamifyResponse(_streamHandlerImpl);
```

**修复（commit 090ff5c）：** 修改 `backend/src/analyze/index.mjs`，已 push，等待部署完成后用 Chrome 验证。

---

## 当前状态

- ✅ 403 已修复（Lambda 可被公开 invoke）
- ✅ Streaming handler 路径修复已部署
- ✅ Chrome 端到端验证通过：划词"一束光" → 正确返回翻译、definition、潜台词、情绪色彩

### Step 3：检查 CloudWatch Logs Insights

如果上面步骤都没结论，用 Logs Insights 查询是否有任何隐藏的初始化错误：
```
aws logs start-query \
  --log-group-name /aws/lambda/mandrain-analyze-stream-dev \
  --start-time <epoch-48h-ago> \
  --end-time <epoch-now> \
  --query-string "fields @message | filter @message like /ERROR/"
```

---

## 相关文件

- `backend/src/analyze/index.mjs` — streamHandler 定义（行 281）
- `backend/cfn-lambda.yaml` — AnalyzeStreamFunction + AnalyzeStreamFunctionUrl 资源
- `extension/background.js` — queryCloudAPIStreaming（行 305+），重试逻辑（行 344-349）
- `.github/workflows/deployment.yml` — 构建/打包/部署流程
