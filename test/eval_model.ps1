# =============================================================
# Mandrain Keyword — 中文语义理解评测脚本 v2 (PowerShell)
# 使用方法：
#   1. 修改下方 $API 和 $LICENSE_TOKEN
#   2. 在 PowerShell 中运行: .\test\eval_model.ps1
#   3. 结果写入 eval_results.json
#
# 评测维度 (v2):
#   结构通过 (STRUCT) — 返回 zh/en/implication 字段
#   准确通过 (ACCURACY) — implication/en/definition 命中期望关键词
#   最终状态: PASS / PARTIAL / FAIL / INCOMPLETE / ERROR
#
# 用例分类:
#   A = 网络流行语 (手工上下文)
#   B = 反讽/弦外之音
#   C = 情绪表达
#   D = 社会现象词
#   E = 带上下文的完整语句
#   N = 嘈杂真实上下文 (模拟社交媒体/新闻/论坛)
#   M = 无上下文 / 极少上下文
#   L = 字面义 vs 俚语歧义
#   J = 2024-2025 最新网络词
#   K = 反向夸赞 / 双关
# =============================================================

$API           = "https://zeesoi54x2.execute-api.us-east-1.amazonaws.com/v1"
$LICENSE_TOKEN = "test-license-001"
$INSTALL_ID    = "eval-device-001"
$RESULTS_FILE  = "eval_results.json"
$SLEEP_SEC     = 1

# Lambda Function URL — 绕过 API Gateway 29s 超时限制
# 部署后从 CloudFormation 输出获取，格式: https://xxxxxx.lambda-url.us-east-1.on.aws/
# 留空则走 API Gateway（受 29s 限制）
# 可通过环境变量 MANDRAIN_FUNCTION_URL 设置
$FUNCTION_URL = if ($env:MANDRAIN_FUNCTION_URL) { $env:MANDRAIN_FUNCTION_URL } else { "" }

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

# 确定 analyze 端点
if ($FUNCTION_URL) {
    $ANALYZE_URL = $FUNCTION_URL
    Write-Host ">>> 使用 Lambda Function URL (无 29s 限制): $($ANALYZE_URL.Substring(0, [Math]::Min(50, $ANALYZE_URL.Length)))..." -ForegroundColor Green
} else {
    $ANALYZE_URL = "$API/api/v1/analyze"
    Write-Host ">>> 使用 API Gateway (29s 超时限制): $ANALYZE_URL" -ForegroundColor Yellow
    Write-Host "    提示: 设置 `$env:MANDRAIN_FUNCTION_URL 环境变量可绕过 29s 限制" -ForegroundColor Yellow
}
Write-Host ""

# ---- 评测用例 ----
# 格式: @{ text; prefix; suffix; category; note; keywords }
# keywords: 逗号分隔，匹配 implication+en+definition，命中 ≥1 个即准确通过
$CASES = @(
    # =====================================================================
    # A: 网络流行语 — 手工上下文 (baseline)
    # =====================================================================
    @{ text="内卷"; prefix="大家都在拼命加班"; suffix="，谁也不敢先走"; category="A"; note="网络流行语，应有社会竞争含义"; keywords="competition,rat race,overwork,compete" }
    @{ text="躺平"; prefix="与其拼死拼活，不如直接"; suffix="，爱咋咋地"; category="A"; note="网络流行语，应有放弃竞争含义"; keywords="give up,quit,refuse,opt out,lying flat" }
    @{ text="破防"; prefix="看到他的告别信，我直接"; suffix="了"; category="A"; note="网络流行语，应有情绪崩溃含义"; keywords="emotional,overwhelm,break down,touched,moved" }
    @{ text="凡尔赛"; prefix="她又在朋友圈"; suffix="了，说老公送的包太多放不下"; category="A"; note="网络流行语，应体现显摆/炫耀含义"; keywords="brag,show off,humble ?brag,flaunt" }
    @{ text="抽象"; prefix="这个主播的操作真的太"; suffix="了，笑死"; category="A"; note="当代网络用语，不是传统意义的抽象"; keywords="absurd,ridiculous,bizarre,nonsens" }
    @{ text="典中典"; prefix="这个回复属于是"; suffix="了，经典到不行"; category="A"; note="网络用语，应表示极具代表性/典型"; keywords="classic,typical,quintessential,iconic" }
    @{ text="有点东西"; prefix="这个新人表现"; suffix="啊，刮目相看"; category="A"; note="应表示厉害/出乎意料"; keywords="impressive,talent,unexpected,skill" }
    @{ text="这波属于"; prefix="大盘跌的时候他满仓抄底，"; suffix="神操作了"; category="A"; note="应表示某次操作/行为值得称道"; keywords="move,play,operation,maneuver" }

    # =====================================================================
    # B: 反讽/弦外之音
    # =====================================================================
    @{ text="你品，你细品"; prefix="他说他每天只工作四小时，"; suffix="，真的只有四小时吗"; category="B"; note="提示听者回味，通常暗示有隐情"; keywords="think about,ponder,hint,between the lines,implication" }
    @{ text="真有你的"; prefix="你把客户的数据删了？"; suffix="啊"; category="B"; note="可以是赞赏，也可以是反讽"; keywords="sarcas,ironic,impress,rhetorical" }
    @{ text="我哭死"; prefix="他居然给我买了限量版球鞋，"; suffix=""; category="B"; note="夸张表达，不是真在哭"; keywords="exaggerat,overwhelm,dramatic,not literally" }
    @{ text="他真的很努力"; prefix="虽然结果不怎么样，但"; suffix="，态度分给满"; category="B"; note="字面是夸，但有时是在讽刺"; keywords="sarcas,ironic,backhand,despite,token praise" }

    # =====================================================================
    # C: 情绪表达
    # =====================================================================
    @{ text="上价值"; prefix="你别动不动就"; suffix="，吃个饭而已"; category="C"; note="单方面把对话拔高到道德/意义层面，含贬义"; keywords="moral,virtue,lecture,preach,elevat" }
    @{ text="阴阳怪气"; prefix="他说话总是"; suffix="的，让人很不舒服"; category="C"; note="用表面正常的话语暗中讽刺"; keywords="passive.aggressive,sarcas,snide,indirect,backhanded" }
    @{ text="爹味"; prefix="他教训人的样子真的"; suffix="十足"; category="C"; note="指说话居高临下、自以为是的男性气质，贬义"; keywords="condescend,patroniz,mansplain,preach,authoritarian" }
    @{ text="PUA"; prefix="她男朋友一直在"; suffix="她，让她觉得自己什么都不行"; category="C"; note="在中文语境里含义已扩展"; keywords="manipulat,gaslight,emotional abuse,control" }

    # =====================================================================
    # D: 社会现象词
    # =====================================================================
    @{ text="打工人"; prefix="早安"; suffix="！干饭人，干饭魂"; category="D"; note="应体现既是自嘲也是团结感"; keywords="worker,wage,hustle,grind,self-deprecat,solidarity" }
    @{ text="韭菜"; prefix="散户又被割"; suffix="了，庄家赚麻了"; category="D"; note="在金融/商业语境指被割的散户"; keywords="exploit,harvest,sucker,retail investor,victim,fleece" }
    @{ text="卷王"; prefix="他每天学到凌晨三点，是我们班的"; suffix="，太可怕了"; category="D"; note="努力内卷者，带有戏谑语气"; keywords="overachiev,grind,workaholic,competit" }
    @{ text="社恐"; prefix="不想参加团建，我"; suffix="犯了"; category="D"; note="不仅是社交恐惧症，在口语里是轻松自嘲用法"; keywords="social anxiety,introvert,antisocial,awkward" }

    # =====================================================================
    # E: 带语境的完整段落 (无 prefix/suffix，全句作为 text)
    # =====================================================================
    @{ text="领导说大家辛苦了，周末别休息，再冲一冲"; prefix=""; suffix=""; category="E"; note="应识别出反话/压榨含义而非真诚感谢"; keywords="exploit,overwork,mandatory,ironic,forced" }
    @{ text="她说你今天挺会穿的"; prefix=""; suffix=""; category="E"; note="可能是真夸也可能是嘲讽，应分析歧义"; keywords="ambiguous,compliment,sarcas,backhanded" }
    @{ text="他发朋友圈不是分享生活，是在凡尔赛"; prefix=""; suffix=""; category="E"; note="应解释凡尔赛在此处的用法"; keywords="brag,show off,humble ?brag,flaunt" }

    # =====================================================================
    # N: 嘈杂真实上下文 — 模拟浏览器抓取的前后200字符
    # =====================================================================
    # N1: 微博风格
    @{ text="内卷"; prefix="@小明同学 03-12 22:41 转发了@职场吐槽君: 说真的现在整个行业都在"; suffix="，我朋友做互联网的周末也在加班😭 转发 28 评论 156 赞 1.2万"; category="N"; note="微博嘈杂上下文，应仍能识别网络流行语含义"; keywords="competition,rat race,overwork,compete" }
    @{ text="躺平"; prefix="微博正文 已编辑 · 来自iPhone 16 Pro · 2026-03-10 不想奋斗了真的好累直接"; suffix="算了，评论区都在说我摆烂但我真的只想休息一下啊 收藏 转发"; category="N"; note="含时间戳和设备信息噪声"; keywords="give up,quit,refuse,opt out,lying flat" }
    @{ text="韭菜"; prefix="置顶 关注 财经早知道 发布于 2026-03-13 08:30 A股又跌了散户继续当"; suffix="被收割，什么时候才能翻身 阅读量 8.5万 评论 523 分享到微信"; category="N"; note="财经号文章嘈杂上下文"; keywords="exploit,harvest,sucker,retail investor,victim,fleece" }
    @{ text="PUA"; prefix="热搜第3 #职场PUA# 今日话题：老板天天说你不行还不让你走，这不就是在"; suffix="员工吗？ 讨论 1.2万 阅读 890万 导语 主持人"; category="N"; note="热搜话题页面噪声"; keywords="manipulat,gaslight,emotional abuse,control" }
    # N2: 知乎风格
    @{ text="社恐"; prefix="关注问题 ▾ 写回答 1,284 个回答 问题: 有没有严重"; suffix="的朋友分享一下你们怎么应对公司团建的？ 匿名用户 刚回答 排序: 默认"; category="N"; note="知乎问答页面"; keywords="social anxiety,introvert,antisocial,awkward" }
    @{ text="打工人"; prefix="知乎 · 有问题就会有答案 热榜 # 早安"; suffix="是什么心态，是自嘲还是真的乐观？ 关注者 2.3万 回答 856 浏览 120万"; category="N"; note="知乎热榜文章"; keywords="worker,wage,hustle,grind,self-deprecat,solidarity" }
    # N3: 新闻网站风格
    @{ text="内卷"; prefix="首页 > 社会 > 教育 新华网北京3月13日电 教育部今日发布报告指出高等教育"; suffix="现象日趋严重建议各高校采取措施减轻学生压力 责任编辑: 张三 来源: 新华社"; category="N"; note="新闻正式语境"; keywords="competition,rat race,overwork,compete,pressure" }
    @{ text="凡尔赛"; prefix="来源: 澎湃新闻 2026-03-12 15:00 近日某博主因在社交平台频繁"; suffix="式发言引发热议，网友纷纷表示受不了这种假装抱怨实则炫耀的行为 相关推荐 评论区"; category="N"; note="新闻报道"; keywords="brag,show off,humble ?brag,flaunt,boast" }
    # N4: 微信公众号风格
    @{ text="破防"; prefix="原创 深夜情感FM 2026-03-11 阅读 10万+ 凌晨三点看到前任结婚的消息彻底"; suffix="了，评论区点赞最多的那条回复让我更难受 精选留言 置顶"; category="N"; note="公众号文章"; keywords="emotional,overwhelm,break down,touched,devastat" }

    # =====================================================================
    # M: 无/极少上下文 — 模拟用户在标题、按钮、列表中选词
    # =====================================================================
    @{ text="内卷"; prefix=""; suffix=""; category="M"; note="完全无上下文，纯词语"; keywords="competition,rat race,overwork,compete" }
    @{ text="躺平"; prefix=""; suffix=""; category="M"; note="完全无上下文"; keywords="give up,quit,refuse,opt out,lying flat" }
    @{ text="PUA"; prefix=""; suffix=""; category="M"; note="完全无上下文"; keywords="manipulat,gaslight,pick.up artist,emotional" }
    @{ text="韭菜"; prefix=""; suffix=""; category="M"; note="完全无上下文"; keywords="exploit,harvest,chive,sucker,victim,leek" }
    @{ text="破防"; prefix=""; suffix=""; category="M"; note="完全无上下文"; keywords="emotional,overwhelm,break down,touched" }
    @{ text="阴阳怪气"; prefix=""; suffix=""; category="M"; note="完全无上下文"; keywords="passive.aggressive,sarcas,snide,indirect" }
    @{ text="凡尔赛"; prefix="#凡尔赛"; suffix=""; category="M"; note="仅一个标签作前缀"; keywords="brag,show off,humble ?brag,flaunt" }
    @{ text="社恐"; prefix="今日话题:"; suffix=""; category="M"; note="极短前缀"; keywords="social anxiety,introvert,antisocial" }

    # =====================================================================
    # L: 字面义 vs 俚语歧义 — 模型必须根据上下文区分
    # =====================================================================
    @{ text="躺平"; prefix="做完瑜伽后教练让大家"; suffix="放松，闭上眼睛深呼吸三次"; category="L"; note="字面义：真的躺在地上，不是网络俚语"; keywords="lie down,lie flat,yoga,relax,physical" }
    @{ text="破防"; prefix="这款新型穿甲弹可以轻易"; suffix="敌方坦克的装甲"; category="L"; note="军事字面义：穿透防御，不是情绪崩溃"; keywords="penetrat,armor,breach,defence,defense,pierce" }
    @{ text="韭菜"; prefix="今天菜市场的"; suffix="特别新鲜，才两块钱一斤"; category="L"; note="字面义：蔬菜，不是被割的散户"; keywords="chive,vegetable,leek,green,garlic" }
    @{ text="抽象"; prefix="毕加索的这幅画非常"; suffix="，让人看不懂"; category="L"; note="传统义：艺术风格，不是网络用语的荒诞"; keywords="abstract,art,style,painting,non-representational" }
    @{ text="打工人"; prefix="这台机器人可以替代"; suffix="完成重复性劳动"; category="L"; note="中性/字面义：泛指劳动者，不含自嘲"; keywords="worker,laborer,employee,replace,automat" }
    @{ text="上价值"; prefix="这套邮票随着年份增长不断"; suffix="，现在已经翻了十倍"; category="L"; note="字面义：价格上涨/增值，不是道德绑架"; keywords="appreciat,value,increase,price,worth" }

    # =====================================================================
    # J: 2024-2025 最新网络词
    # =====================================================================
    @{ text="水灵灵地"; prefix="她今天打扮得"; suffix="走进了办公室"; category="J"; note="形容人某种行为做得格外顺溜自然，口语化"; keywords="" }
    @{ text="原神，启动"; prefix="下班了，今晚没事干，"; suffix="！"; category="J"; note="源自游戏梗，转义为开始做某事，带戏谑感"; keywords="" }
    @{ text="尊嘟假嘟"; prefix="他说他年薪百万？"; suffix="？"; category="J"; note="谐音'真的假的'，表示不敢置信，幼稚可爱语气"; keywords="" }
    @{ text="捏"; prefix="好的"; suffix="，我知道了"; category="J"; note="语气词，表撒娇或卖萌，来自网络语"; keywords="" }
    @{ text="出警"; prefix="粉丝又在控评了，反黑组赶紧"; suffix=""; category="J"; note="网络用语，指有人来纠错/维权，常带讽刺意味"; keywords="" }
    @{ text="磕到了"; prefix="看到他俩同框的照片，我"; suffix="！甜死了"; category="J"; note="嗑 CP 时被感动，表达对两人关系的沉迷"; keywords="" }
    @{ text="夺笋"; prefix="他居然把前任的礼物送给现任，真是太"; suffix="了"; category="J"; note="谐音'多损'，指行为过分，带戏谑批评语气"; keywords="" }
    @{ text="yyds"; prefix="梅西这球踢得太好了，"; suffix="！"; category="J"; note="永远的神的缩写，极度赞美，已渐渐被过度使用"; keywords="" }

    # =====================================================================
    # K: 反向夸赞 / 双关
    # =====================================================================
    @{ text="懂得都懂"; prefix="他和那个女同事的关系嘛，"; suffix="，我就不多说了"; category="K"; note="暗示有内情但不明说，测试模型是否能识别隐晦表达"; keywords="" }
    @{ text="你真的好勇哦"; prefix="你竟然当面跟老板说这个，"; suffix=""; category="K"; note="表面夸勇敢，实际多为反讽对方鲁莽"; keywords="" }
    @{ text="建议你好好想想"; prefix="你确定要发这条朋友圈？"; suffix=""; category="K"; note="委婉批评，暗示对方做了不妥的事"; keywords="" }
    @{ text="有被帅到"; prefix="他今天穿西装打领带的样子，"; suffix=""; category="K"; note="表达被某人或某事惊艳，可以是真心也可调侃"; keywords="" }
    @{ text="遥遥领先"; prefix="华为发布会又说自己"; suffix="，评论区全是嘲讽"; category="K"; note="原海外发布会金句，现已异化为嘲讽某品牌过度吹嘘"; keywords="" }
    # L2: 身份/阶层词
    @{ text="小镇做题家"; prefix="我就是个典型的"; suffix="，从小县城刷题刷到985"; category="K"; note="来自农村小镇靠做题上名校的学生，带自嘲和社会批评"; keywords="" }
    @{ text="985废物"; prefix="毕业三年还在投简历，"; suffix="就是我本人了"; category="K"; note="名校毕业却找不到好工作者的自嘲，反映就业焦虑"; keywords="" }
    @{ text="精英感"; prefix="她说话做事都有一种"; suffix="，让人觉得距离很远"; category="K"; note="某类人散发的优越气质，可褒可贬取决于语境"; keywords="" }
    @{ text="废柴"; prefix="别指望他了，他就是个"; suffix=""; category="K"; note="自嘲或贬低型词，指能力差/没出息的人"; keywords="" }
    @{ text="普信男"; prefix="他条件一般还要求女方肤白貌美，典型的"; suffix=""; category="K"; note="过度自信却无实力的男性，讽刺意味强"; keywords="" }

    # =====================================================================
    # M2: 完整句子测试 (from original PS1)
    # =====================================================================
    @{ text="这件事你得好好感谢他，要不是他，你早完了"; prefix=""; suffix=""; category="M"; note="应识别表面感谢背后暗藏的压力和威胁感"; keywords="" }
    @{ text="她那个笑啊，懂的都懂"; prefix=""; suffix=""; category="M"; note="应识别'懂的都懂'的暗示性含义，不明说但暗有恶意"; keywords="" }
    @{ text="他喝了点酒，讲了好多真心话"; prefix=""; suffix=""; category="M"; note="应识别'酒后吐真言'的潜台词和信息暴露风险"; keywords="" }
    @{ text="领导说不差你这点加班费"; prefix=""; suffix=""; category="M"; note="应识别强迫加班的话术，表面大方实则压榨"; keywords="" }
    @{ text="她说她不开心但没事"; prefix=""; suffix=""; category="M"; note="应识别中国人/女性表达委屈时的隐晦否定语气"; keywords="" }
)

# ---- Helper: keyword matching ----
function Test-KeywordMatch {
    param([string]$SearchText, [string]$Keywords)
    if (-not $Keywords) { return @{ matched = $true; words = "" } }

    $searchLower = $SearchText.ToLower()
    $kwList = $Keywords -split ','
    $matched = @()
    foreach ($kw in $kwList) {
        $pattern = $kw.Trim() -replace ' ', '.*'
        if ($searchLower -match $pattern) {
            $matched += $kw.Trim()
        }
    }
    if ($matched.Count -gt 0) {
        return @{ matched = $true; words = ($matched[0..([Math]::Min(2, $matched.Count - 1))] -join ',') }
    }
    return @{ matched = $false; words = "" }
}

# ---- Helper: parse NDJSON streaming response ----
function Read-StreamResponse {
    param([string]$RawText)
    $lines = $RawText -split "`n"
    # Walk backwards to find the last "result" event
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        $line = $lines[$i].Trim()
        if (-not $line) { continue }
        try {
            $obj = $line | ConvertFrom-Json -ErrorAction Stop
            if ($obj.type -eq 'result') {
                return $obj.data
            }
            if ($obj.type -eq 'error') {
                return [PSCustomObject]@{ error = $obj.error; message = $obj.message }
            }
        } catch { continue }
    }
    return [PSCustomObject]@{ error = "NO_RESULT"; message = "No result event in stream" }
}

$total     = $CASES.Count
$pass      = 0
$partial   = 0
$fail      = 0
$incomplete = 0
$results   = [System.Collections.Generic.List[PSObject]]::new()

Write-Host ">>> 开始评测，共 $total 条用例 ..." -ForegroundColor Cyan
Write-Host ">>> 结果写入 $RESULTS_FILE" -ForegroundColor Cyan
Write-Host ">>> 评分: PASS=结构+准确 | PARTIAL=仅结构 | FAIL=错误 | INCOMPLETE=缺字段" -ForegroundColor Cyan
Write-Host ""

foreach ($case in $CASES) {
    $text     = $case.text
    $category = $case.category
    $note     = $case.note
    $keywords = if ($case.keywords) { $case.keywords } else { '' }
    $prefix   = if ($case.prefix) { $case.prefix } else { '' }
    $suffix   = if ($case.suffix) { $case.suffix } else { '' }

    $displayText = if ($text.Length -gt 20) { $text.Substring(0, 20) } else { $text }
    Write-Host -NoNewline "  [$category] $displayText ... "

    $bodyHash = @{ text = $text; lang = "zh" }
    if ($prefix) { $bodyHash.prefix = $prefix }
    if ($suffix) { $bodyHash.suffix = $suffix }
    $analyzeBody = $bodyHash | ConvertTo-Json
    $analyzeBytes = [System.Text.Encoding]::UTF8.GetBytes($analyzeBody)

    $resp = $null
    $status = ""
    $color = "White"
    $extra = ""
    $matchedKw = ""
    $modelName = "?"

    try {
        if ($FUNCTION_URL) {
            # ---- Streaming path: read raw NDJSON, extract result event ----
            $rawResp = Invoke-WebRequest -Uri $ANALYZE_URL `
                -Method POST `
                -Body $analyzeBytes `
                -ContentType "application/json; charset=utf-8" `
                -Headers @{ Authorization = "Bearer $TOKEN" } `
                -TimeoutSec 120 `
                -UseBasicParsing

            $resp = Read-StreamResponse -RawText $rawResp.Content
        } else {
            # ---- Sync path: standard JSON response ----
            $resp = Invoke-RestMethod -Uri $ANALYZE_URL `
                -Method POST `
                -Body $analyzeBytes `
                -ContentType "application/json; charset=utf-8" `
                -Headers @{ Authorization = "Bearer $TOKEN" } `
                -TimeoutSec 90
        }

        # Check for error in response
        if ($resp.error) {
            $status = "ERROR"
            $fail++
            $color = "Red"
            $extra = "$($resp.error): $($resp.message)"
        } else {
            # ---- 结构检查 ----
            $hasZh          = $null -ne $resp.zh
            $hasEn          = $null -ne $resp.en
            $hasImplication = $null -ne $resp.implication
            $structOk       = $hasZh -and $hasEn -and $hasImplication

            if (-not $structOk) {
                $missing = @()
                if (-not $hasZh)          { $missing += "zh" }
                if (-not $hasEn)          { $missing += "en" }
                if (-not $hasImplication) { $missing += "implication" }
                $status = "INCOMPLETE"
                $incomplete++
                $color = "Yellow"
                $extra = "缺少字段: $($missing -join ', ')"
            } else {
                # ---- 准确性检查：关键词匹配 ----
                $modelName = if ($resp.model) { $resp.model } else { '?' }
                $searchText = @($resp.implication, $resp.en, $resp.definition) -join ' '
                $kwResult = Test-KeywordMatch -SearchText $searchText -Keywords $keywords
                $matchedKw = $kwResult.words

                if ($kwResult.matched) {
                    $status = "PASS"
                    $pass++
                    $color = "Green"
                    if ($matchedKw) {
                        $extra = "model:$modelName  kw:$matchedKw"
                    } else {
                        $extra = "model:$modelName  sentiment:$($resp.sentiment)"
                    }
                } else {
                    $status = "PARTIAL"
                    $partial++
                    $color = "DarkYellow"
                    $extra = "model:$modelName  结构OK但关键词未命中"
                }
            }
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
        text             = $text
        category         = $category
        note             = $note
        status           = $status
        keywords_expected = $keywords
        keywords_matched = $matchedKw
        model            = $modelName
        response         = $resp
    })

    Start-Sleep -Seconds $SLEEP_SEC
}

# ---- 写入结果文件 ----
$results | ConvertTo-Json -Depth 10 | Out-File -FilePath $RESULTS_FILE -Encoding UTF8

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  评测完成 (共 $total 条)" -ForegroundColor Cyan
Write-Host "    PASS     : $pass   (结构+准确)" -ForegroundColor Green
Write-Host "    PARTIAL  : $partial   (结构OK 准确不足)" -ForegroundColor DarkYellow
Write-Host "    INCOMPLETE: $incomplete   (缺少字段)" -ForegroundColor Yellow
Write-Host "    ERROR    : $fail   (请求报错)" -ForegroundColor Red
Write-Host ""

# ---- 准确率计算 ----
$structPassCount = $pass + $partial
if ($structPassCount -gt 0) {
    $accuracyRate = [Math]::Round($pass / $structPassCount * 100, 1)
} else {
    $accuracyRate = 0
}
$structRate = [Math]::Round($structPassCount / $total * 100, 1)
Write-Host "  结构通过率: ${structRate}%"
Write-Host "  准确率:     ${accuracyRate}%  (在结构通过基础上)"
Write-Host "  详细结果: $RESULTS_FILE"
Write-Host "============================================"
Write-Host ""

# ---- 按类别统计 ----
Write-Host "--- 按类别汇总 ---" -ForegroundColor Cyan
$catLabels = @{
    'A'='网络流行语'; 'B'='反讽弦外音'; 'C'='情绪表达'
    'D'='社会现象词'; 'E'='完整语句'; 'N'='嘈杂上下文'
    'M'='无/极少上下文'; 'L'='字面义歧义'; 'J'='最新网络词'; 'K'='反向夸赞/双关'
}
Write-Host ("  {0,-4} {1,-12} {2,-6} {3,-6} {4,-6} {5,-6} {6,-8}" -f "类别","说明","通过","部分","缺字段","错误","准确率")
Write-Host ("  " + ("-" * 56))
foreach ($cat in ($results | Select-Object -ExpandProperty category -Unique | Sort-Object)) {
    $catItems = $results | Where-Object { $_.category -eq $cat }
    $catPass  = ($catItems | Where-Object { $_.status -eq "PASS" }).Count
    $catPartial = ($catItems | Where-Object { $_.status -eq "PARTIAL" }).Count
    $catIncomplete = ($catItems | Where-Object { $_.status -eq "INCOMPLETE" }).Count
    $catError = ($catItems | Where-Object { $_.status -in @("FAIL","ERROR") }).Count
    $catStructOk = $catPass + $catPartial
    $catAcc = if ($catStructOk -gt 0) { "$([Math]::Round($catPass / $catStructOk * 100, 0))%" } else { "N/A" }
    $label = if ($catLabels[$cat]) { $catLabels[$cat] } else { $cat }
    Write-Host ("  {0,-4} {1,-12} {2,-6} {3,-6} {4,-6} {5,-6} {6,-8}" -f $cat, $label, $catPass, $catPartial, $catIncomplete, $catError, $catAcc)
}
Write-Host ""

# ---- 打印非 PASS 项 ----
$nonPassItems = $results | Where-Object { $_.status -ne "PASS" }
if ($nonPassItems.Count -gt 0) {
    Write-Host "--- 非 PASS 用例 ---" -ForegroundColor Yellow
    foreach ($item in $nonPassItems) {
        Write-Host "  [$($item.status)] $($item.text) — $($item.note)" -ForegroundColor Yellow
    }
    Write-Host ""
}

Write-Host "--- 查看某条完整响应 (例如 '内卷') ---"
Write-Host "  `$r = Get-Content $RESULTS_FILE | ConvertFrom-Json; `$r | Where-Object { `$_.text -eq '内卷' } | ConvertTo-Json -Depth 10"
