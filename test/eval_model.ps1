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
    # F: 新生代网络词
    @{ text="整顿职场";     category="F"; note="有主动对抗不合理职场规则的含义" }
    @{ text="发疯文学";     category="F"; note="用夸张混乱语气表达不满的网络写作风格" }
    @{ text="班味";         category="F"; note="上班后身上散发的疲惫/压抑气质，自嘲" }
    @{ text="嘴替";         category="F"; note="帮别人说出心声的人，应说明语境" }
    @{ text="松弛感";       category="F"; note="不焦虑、随性自在的状态，与内卷相对" }
    @{ text="哈人";         category="F"; note="东北/网络用语，表示害怕/吓人" }
    @{ text="泼天富贵";     category="F"; note="突然涌来的巨大机遇或流量，应说明讽刺用法" }
    @{ text="显眼包";       category="F"; note="爱出风头、特别引人注意的人，褒贬取决于语境" }
    # G: 职场黑话/隐语
    @{ text="对齐颗粒度";   category="G"; note="职场黑话，表示细化沟通，有时被讽刺为废话" }
    @{ text="赋能";         category="G"; note="商业/职场高频词，已被过度使用至沦为空话" }
    @{ text="闭环";         category="G"; note="职场语，处理完某件事的完整流程，有时是官僚术语" }
    @{ text="向上管理";     category="G"; note="管理上级对自己印象的策略，带职场算计含义" }
    @{ text="躺平式干部";   category="G"; note="不求上进、混日子的官员或员工，贬义" }
    # H: 情感/关系用语
    @{ text="舔狗";         category="H"; note="无底线讨好对方的人，自嘲或贬义" }
    @{ text="绿茶";         category="H"; note="表面清纯实则心机的女性，贬义" }
    @{ text="海王";         category="H"; note="同时周旋多个异性的人，贬义" }
    @{ text="拿捏";         category="H"; note="完全掌控某人/某事，语气可赞赏或嘲讽" }
    @{ text="恋爱脑";       category="H"; note="凡事以感情为优先，带贬义" }
    # I: 带语境的完整句子
    @{ text="我就是个普通打工人，没什么追求"; category="I"; note="应识别出自嘲背后的无奈/认命感" }
    @{ text="他这个人很会来事儿";             category="I"; note="应说明可能是夸善于处事，也可能是讽刺圆滑" }
    @{ text="你这波操作我给满分";             category="I"; note="可以是真心称赞，也可以是反讽，应分析歧义" }
    @{ text="她不是在哭，她在发疯";           category="I"; note="应识别发疯为宣泄情绪、而非精神疾病" }
    @{ text="这个项目就是在走形式";           category="I"; note="应识别批评官僚/表面功夫的含义" }
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
