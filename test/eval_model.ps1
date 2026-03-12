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
    # J: 2024-2025 最新网络词
    @{ text="水灵灵地";     category="J"; note="形容人某种行为做得格外顺溜自然，口语化" }
    @{ text="原神，启动";   category="J"; note="源自游戏梗，转义为开始做某事，带戏谑感" }
    @{ text="尊嘟假嘟";     category="J"; note="谐音'真的假的'，表示不敢置信，幼稚可爱语气" }
    @{ text="捏";           category="J"; note="语气词，表撒娇或卖萌，来自网络语" }
    @{ text="出警";         category="J"; note="网络用语，指有人来纠错/维权，常带讽刺意味" }
    @{ text="磕到了";       category="J"; note="嗑 CP 时被感动，表达对两人关系的沉迷" }
    @{ text="夺笋";         category="J"; note="谐音'多损'，指行为过分，带戏谑批评语气" }
    @{ text="yyds";         category="J"; note="永远的神的缩写，极度赞美，已渐渐被过度使用" }
    # K: 反向夸赞 / 双关
    @{ text="懂得都懂";     category="K"; note="暗示有内情但不明说，测试模型是否能识别隐晦表达" }
    @{ text="你真的好勇哦"; category="K"; note="表面夸勇敢，实际多为反讽对方鲁莽" }
    @{ text="建议你好好想想"; category="K"; note="委婉批评，暗示对方做了不妥的事" }
    @{ text="有被帅到";     category="K"; note="表达被某人或某事惊艳，可以是真心也可调侃" }
    @{ text="遥遥领先";     category="K"; note="原海外发布会金句，现已异化为嘲讽某品牌过度吹嘘" }
    # L: 身份/阶层词
    @{ text="小镇做题家";   category="L"; note="来自农村小镇靠做题上名校的学生，带自嘲和社会批评" }
    @{ text="985废物";      category="L"; note="名校毕业却找不到好工作者的自嘲，反映就业焦虑" }
    @{ text="精英感";       category="L"; note="某类人散发的优越气质，可褒可贬取决于语境" }
    @{ text="废柴";         category="L"; note="自嘲或贬低型词，指能力差/没出息的人" }
    @{ text="普信男";       category="L"; note="过度自信却无实力的男性，讽刺意味强" }
    # M: 完整句子测试
    @{ text="这件事你得好好感谢他，要不是他，你早完了"; category="M"; note="应识别表面感谢背后暗藏的压力和威胁感" }
    @{ text="她那个笑啊，懂的都懂";                   category="M"; note="应识别'懂的都懂'的暗示性含义，不明说但暗有恶意" }
    @{ text="他喝了点酒，讲了好多真心话";             category="M"; note="应识别'酒后吐真言'的潜台词和信息暴露风险" }
    @{ text="领导说不差你这点加班费";                 category="M"; note="应识别强迫加班的话术，表面大方实则压榨" }
    @{ text="她说她不开心但没事";                     category="M"; note="应识别中国人/女性表达委屈时的隐晦否定语气" }
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
