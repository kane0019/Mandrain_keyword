# =============================================================
# Mandrain Keyword — 中文语义理解评测脚本 (PowerShell)
# 使用方法：
#   1. 修改下方 $API 和 $LICENSE_TOKEN
#   2. 在 PowerShell 中运行: .\test\eval_model.ps1
#   3. 结果写入 eval_results.json
# =============================================================

$API           = "https://zeesoi54x2.execute-api.us-east-1.amazonaws.com/v1"
$LICENSE_TOKEN = "test-license-001"
$INSTALL_ID    = "eval-device-001"
$RESULTS_FILE  = "eval_results.json"
$SLEEP_SEC     = 1

# ---- Step 0: 获取 JWT ----
Write-Host ">>> 获取 access_token ..." -ForegroundColor Cyan

$initBody = @{
    license_token  = $LICENSE_TOKEN
    install_id     = $INSTALL_ID
    client_version = "eval-1.0"
    platform       = "eval"
} | ConvertTo-Json

$initResp = Invoke-RestMethod -Uri "$API/api/v1/session/init" `
    -Method POST -Body $initBody -ContentType "application/json"

$TOKEN = $initResp.access_token
if (-not $TOKEN) {
    Write-Host "ERROR: 获取 token 失败" -ForegroundColor Red
    Write-Host ($initResp | ConvertTo-Json)
    exit 1
}
Write-Host "    token 已获取 ($($TOKEN.Substring(0,20))...)" -ForegroundColor Green
Write-Host ""

# ---- 评测用例 ----
# 格式: @{ text; category; note }
$CASES = @(
    # A: 网络流行语
    @{ text="内卷";         category="A"; note="应有社会竞争含义" }
    @{ text="躺平";         category="A"; note="应有放弃竞争含义" }
    @{ text="破防";         category="A"; note="应有情绪崩溃含义" }
    @{ text="凡尔赛";       category="A"; note="应体现显摆/炫耀含义" }
    @{ text="抽象";         category="A"; note="当代网络用语，不是传统意义的抽象" }
    @{ text="典中典";       category="A"; note="应表示极具代表性/典型" }
    @{ text="有点东西";     category="A"; note="应表示厉害/出乎意料" }
    @{ text="这波属于";     category="A"; note="应表示某次操作/行为值得称道" }
    # B: 反讽/弦外之音
    @{ text="你品，你细品"; category="B"; note="提示听者回味，通常暗示有隐情" }
    @{ text="真有你的";     category="B"; note="可以是赞赏，也可以是反讽，应说明语境" }
    @{ text="我哭死";       category="B"; note="夸张表达，不是真在哭，应说明情绪夸张用法" }
    @{ text="他真的很努力"; category="B"; note="字面是夸，但有时是在讽刺" }
    # C: 情绪类
    @{ text="上价值";       category="C"; note="单方面把对话拔高到道德层面，含贬义" }
    @{ text="阴阳怪气";     category="C"; note="用表面正常的话语暗中讽刺，应说清楚" }
    @{ text="爹味";         category="C"; note="说话居高临下、自以为是的男性气质，贬义" }
    @{ text="PUA";          category="C"; note="在中文语境里含义已扩展，应说明与英文原义差异" }
    # D: 社会现象词
    @{ text="打工人";       category="D"; note="应体现既是自嘲也是团结感" }
    @{ text="韭菜";         category="D"; note="在金融/商业语境指被割的散户或普通人" }
    @{ text="卷王";         category="D"; note="努力内卷者，带有戏谑语气" }
    @{ text="社恐";         category="D"; note="不仅是社交恐惧症，在口语里是轻松自嘲用法" }
    # E: 带语境的段落
    @{ text="领导说大家辛苦了，周末别休息，再冲一冲"; category="E"; note="应识别出反话/压榨含义而非真诚感谢" }
    @{ text="她说你今天挺会穿的";                     category="E"; note="可能是真夸也可能是嘲讽，应分析歧义" }
    @{ text="他发朋友圈不是分享生活，是在凡尔赛";     category="E"; note="应解释凡尔赛在此处的用法" }
)

$total = $CASES.Count
$pass  = 0
$fail  = 0
$results = [System.Collections.Generic.List[PSObject]]::new()

Write-Host ">>> 开始评测，共 $total 条用例 ..." -ForegroundColor Cyan
Write-Host ""

foreach ($case in $CASES) {
    $text     = $case.text
    $category = $case.category
    $note     = $case.note

    Write-Host -NoNewline "  [$category] $text ... "

    $analyzeBody = @{ text = $text; lang = "zh" } | ConvertTo-Json
    $analyzeBytes = [System.Text.Encoding]::UTF8.GetBytes($analyzeBody)

    try {
        $resp = Invoke-RestMethod -Uri "$API/api/v1/analyze" `
            -Method POST `
            -Body $analyzeBytes `
            -ContentType "application/json; charset=utf-8" `
            -Headers @{ Authorization = "Bearer $TOKEN" }

        $hasZh         = $null -ne $resp.zh
        $hasEn         = $null -ne $resp.en
        $hasImplication = $null -ne $resp.implication
        $hasSentiment  = $null -ne $resp.sentiment

        if ($hasZh -and $hasEn -and $hasImplication) {
            $status = "PASS"
            $pass++
            $color = "Green"
            $extra = "sentiment=$($resp.sentiment)"
        } else {
            $missing = @()
            if (-not $hasZh)          { $missing += "zh" }
            if (-not $hasEn)          { $missing += "en" }
            if (-not $hasImplication) { $missing += "implication" }
            if (-not $hasSentiment)   { $missing += "sentiment" }
            $status = "INCOMPLETE"
            $fail++
            $color = "Yellow"
            $extra = "缺少字段: $($missing -join ', ')"
        }
    } catch {
        $resp   = $_.Exception.Message
        $status = "FAIL"
        $fail++
        $color  = "Red"
        $extra  = $resp.ToString().Substring(0, [Math]::Min(80, $resp.ToString().Length))
    }

    Write-Host "$status  ($extra)" -ForegroundColor $color

    $results.Add([PSCustomObject]@{
        text     = $text
        category = $category
        note     = $note
        status   = $status
        response = $resp
    })

    Start-Sleep -Seconds $SLEEP_SEC
}

# ---- 写入结果文件 ----
$results | ConvertTo-Json -Depth 10 | Out-File -FilePath $RESULTS_FILE -Encoding UTF8

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  评测完成: $pass 通过 / $fail 失败 / 共 $total 条" -ForegroundColor Cyan
Write-Host "  详细结果: $RESULTS_FILE"
Write-Host "============================================"
Write-Host ""

# ---- 打印失败项 ----
$failedItems = $results | Where-Object { $_.status -ne "PASS" }
if ($failedItems.Count -gt 0) {
    Write-Host "失败/不完整的用例:" -ForegroundColor Yellow
    foreach ($item in $failedItems) {
        Write-Host "  [$($item.status)] $($item.text) — $($item.note)" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ---- 按类别统计 ----
Write-Host "按类别统计:" -ForegroundColor Cyan
foreach ($cat in @("A","B","C","D","E")) {
    $catItems = $results | Where-Object { $_.category -eq $cat }
    $catPass  = ($catItems | Where-Object { $_.status -eq "PASS" }).Count
    Write-Host "  [$cat] $catPass / $($catItems.Count) 通过"
}
Write-Host ""
Write-Host "查看某条完整响应 (例如 '内卷'):"
Write-Host "  `$r = Get-Content $RESULTS_FILE | ConvertFrom-Json; `$r | Where-Object { `$_.text -eq '内卷' } | ConvertTo-Json -Depth 10"
