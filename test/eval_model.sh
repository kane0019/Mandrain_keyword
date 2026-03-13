#!/usr/bin/env bash
# =============================================================
# Mandrain Keyword — 中文语义理解评测脚本 v2
# 使用方法：
#   1. 先拿到 session token (见下方 Step 0)
#   2. 填写 API 和 TOKEN
#   3. bash eval_model.sh
#   4. 结果写入 eval_results.json
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
# =============================================================

set -euo pipefail

# ---- 配置 ----
API="https://zeesoi54x2.execute-api.us-east-1.amazonaws.com/v1"
LICENSE_TOKEN="test-license-001"
INSTALL_ID="eval-device-001"
RESULTS_FILE="eval_results.json"
SLEEP_SEC=1   # 每次请求间隔，防止限流

# ---- Step 0: 获取 JWT ----
echo ">>> 获取 access_token ..."
INIT_RESP=$(curl -s -X POST "$API/api/v1/session/init" \
  -H "Content-Type: application/json" \
  -d "{\"license_token\":\"$LICENSE_TOKEN\",\"install_id\":\"$INSTALL_ID\",\"client_version\":\"eval-1.0\",\"platform\":\"eval\"}")

TOKEN=$(echo "$INIT_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: 获取 token 失败。响应: $INIT_RESP"
  exit 1
fi
echo "    token 已获取 (${TOKEN:0:20}...)"

# ---- 评测用例 ----
# 格式 (pipe-delimited, 5 fields):
#   词语 | 前文 | 后文 | 分类-说明 | 期望关键词(逗号分隔，匹配implication+en+definition)
#
# 关键词匹配规则:
#   - 大小写不敏感
#   - 命中 ≥1 个关键词 → 准确通过
#   - 命中 0 个 → 准确失败 (PARTIAL: 结构通过但语义不准)
declare -a CASES=(
  # =====================================================================
  # A: 网络流行语 — 手工上下文 (baseline)
  # =====================================================================
  "内卷|大家都在拼命加班|，谁也不敢先走|A-网络流行语，应有社会竞争含义|competition,rat race,overwork,compete"
  "躺平|与其拼死拼活，不如直接|，爱咋咋地|A-网络流行语，应有放弃竞争含义|give up,quit,refuse,opt out,lying flat"
  "破防|看到他的告别信，我直接|了|A-网络流行语，应有情绪崩溃含义|emotional,overwhelm,break down,touched,moved"
  "凡尔赛|她又在朋友圈|了，说老公送的包太多放不下|A-网络流行语，应体现显摆/炫耀含义|brag,show off,humble ?brag,flaunt"
  "抽象|这个主播的操作真的太|了，笑死|A-当代网络用语，不是传统意义的抽象|absurd,ridiculous,bizarre,nonsens"
  "典中典|这个回复属于是|了，经典到不行|A-网络用语，应表示极具代表性/典型|classic,typical,quintessential,iconic"
  "有点东西|这个新人表现|啊，刮目相看|A-应表示厉害/出乎意料|impressive,talent,unexpected,skill"
  "这波属于|大盘跌的时候他满仓抄底，|神操作了|A-应表示某次操作/行为值得称道|move,play,operation,maneuver"

  # =====================================================================
  # B: 反讽/弦外之音
  # =====================================================================
  "你品，你细品|他说他每天只工作四小时，|，真的只有四小时吗|B-提示听者回味，通常暗示有隐情|think about,ponder,hint,between the lines,implication"
  "真有你的|你把客户的数据删了？|啊|B-可以是赞赏，也可以是反讽|sarcas,ironic,impress,rhetorical"
  "我哭死|他居然给我买了限量版球鞋，||B-夸张表达，不是真在哭|exaggerat,overwhelm,dramatic,not literally"
  "他真的很努力|虽然结果不怎么样，但|，态度分给满|B-字面是夸，但有时是在讽刺|sarcas,ironic,backhand,despite,token praise"

  # =====================================================================
  # C: 情绪表达
  # =====================================================================
  "上价值|你别动不动就|，吃个饭而已|C-单方面把对话拔高到道德/意义层面，含贬义|moral,virtue,lecture,preach,elevat"
  "阴阳怪气|他说话总是|的，让人很不舒服|C-用表面正常的话语暗中讽刺|passive.aggressive,sarcas,snide,indirect,backhanded"
  "爹味|他教训人的样子真的|十足|C-指说话居高临下、自以为是的男性气质，贬义|condescend,patroniz,mansplain,preach,authoritarian"
  "PUA|她男朋友一直在|她，让她觉得自己什么都不行|C-在中文语境里含义已扩展|manipulat,gaslight,emotional abuse,control"

  # =====================================================================
  # D: 社会现象词
  # =====================================================================
  "打工人|早安|！干饭人，干饭魂|D-应体现既是自嘲也是团结感|worker,wage,hustle,grind,self-deprecat,solidarity"
  "韭菜|散户又被割|了，庄家赚麻了|D-在金融/商业语境指被割的散户|exploit,harvest,sucker,retail investor,victim,fleece"
  "卷王|他每天学到凌晨三点，是我们班的|，太可怕了|D-努力内卷者，带有戏谑语气|overachiev,grind,workaholic,competit"
  "社恐|不想参加团建，我|犯了|D-不仅是社交恐惧症，在口语里是轻松自嘲用法|social anxiety,introvert,antisocial,awkward"

  # =====================================================================
  # E: 带语境的完整段落 (无 prefix/suffix，全句作为 text)
  # =====================================================================
  "领导说大家辛苦了，周末别休息，再冲一冲|||E-应识别出反话/压榨含义而非真诚感谢|exploit,overwork,mandatory,ironic,forced"
  "她说你今天挺会穿的|||E-可能是真夸也可能是嘲讽，应分析歧义|ambiguous,compliment,sarcas,backhanded"
  "他发朋友圈不是分享生活，是在凡尔赛|||E-应解释凡尔赛在此处的用法|brag,show off,humble ?brag,flaunt"

  # =====================================================================
  # N: 嘈杂真实上下文 — 模拟浏览器抓取的前后200字符
  # =====================================================================
  # N1: 微博风格 (用户名、时间戳、emoji、转发)
  "内卷|@小明同学 03-12 22:41 转发了@职场吐槽君: 说真的现在整个行业都在|，我朋友做互联网的周末也在加班😭 转发 28 评论 156 赞 1.2万|N-微博嘈杂上下文，应仍能识别网络流行语含义|competition,rat race,overwork,compete"
  "躺平|微博正文 已编辑 · 来自iPhone 16 Pro · 2026-03-10 不想奋斗了真的好累直接|算了，评论区都在说我摆烂但我真的只想休息一下啊 收藏 转发|N-含时间戳和设备信息噪声|give up,quit,refuse,opt out,lying flat"
  "韭菜|置顶 关注 财经早知道 发布于 2026-03-13 08:30 A股又跌了散户继续当|被收割，什么时候才能翻身 阅读量 8.5万 评论 523 分享到微信|N-财经号文章嘈杂上下文|exploit,harvest,sucker,retail investor,victim,fleece"
  "PUA|热搜第3 #职场PUA# 今日话题：老板天天说你不行还不让你走，这不就是在|员工吗？ 讨论 1.2万 阅读 890万 导语 主持人|N-热搜话题页面噪声|manipulat,gaslight,emotional abuse,control"

  # N2: 知乎风格 (问答、关注数、回答数)
  "社恐|关注问题 ▾ 写回答 1,284 个回答 问题: 有没有严重|的朋友分享一下你们怎么应对公司团建的？ 匿名用户 刚回答 排序: 默认|N-知乎问答页面|social anxiety,introvert,antisocial,awkward"
  "打工人|知乎 · 有问题就会有答案 热榜 # 早安|是什么心态，是自嘲还是真的乐观？ 关注者 2.3万 回答 856 浏览 120万|N-知乎热榜文章|worker,wage,hustle,grind,self-deprecat,solidarity"

  # N3: 新闻网站风格 (正式语体+导航噪声)
  "内卷|首页 > 社会 > 教育 新华网北京3月13日电 教育部今日发布报告指出高等教育|现象日趋严重建议各高校采取措施减轻学生压力 责任编辑: 张三 来源: 新华社|N-新闻正式语境|competition,rat race,overwork,compete,pressure"
  "凡尔赛|来源: 澎湃新闻 2026-03-12 15:00 近日某博主因在社交平台频繁|式发言引发热议，网友纷纷表示受不了这种假装抱怨实则炫耀的行为 相关推荐 评论区|N-新闻报道|brag,show off,humble ?brag,flaunt,boast"

  # N4: 微信公众号/朋友圈风格
  "破防|原创 深夜情感FM 2026-03-11 阅读 10万+ 凌晨三点看到前任结婚的消息彻底|了，评论区点赞最多的那条回复让我更难受 精选留言 置顶|N-公众号文章|emotional,overwhelm,break down,touched,devastat"

  # =====================================================================
  # M: 无/极少上下文 — 模拟用户在标题、按钮、列表中选词
  # =====================================================================
  "内卷|||M-完全无上下文，纯词语|competition,rat race,overwork,compete"
  "躺平|||M-完全无上下文|give up,quit,refuse,opt out,lying flat"
  "PUA|||M-完全无上下文|manipulat,gaslight,pick.up artist,emotional"
  "韭菜|||M-完全无上下文|exploit,harvest,chive,sucker,victim,leek"
  "破防|||M-完全无上下文|emotional,overwhelm,break down,touched"
  "阴阳怪气|||M-完全无上下文|passive.aggressive,sarcas,snide,indirect"
  "凡尔赛|#凡尔赛||M-仅一个标签作前缀|brag,show off,humble ?brag,flaunt"
  "社恐|今日话题:||M-极短前缀|social anxiety,introvert,antisocial"

  # =====================================================================
  # L: 字面义 vs 俚语歧义 — 模型必须根据上下文区分
  # =====================================================================
  "躺平|做完瑜伽后教练让大家|放松，闭上眼睛深呼吸三次|L-字面义：真的躺在地上，不是网络俚语|lie down,lie flat,yoga,relax,physical"
  "破防|这款新型穿甲弹可以轻易|敌方坦克的装甲|L-军事字面义：穿透防御，不是情绪崩溃|penetrat,armor,breach,defence,defense,pierce"
  "韭菜|今天菜市场的|特别新鲜，才两块钱一斤|L-字面义：蔬菜，不是被割的散户|chive,vegetable,leek,green,garlic"
  "抽象|毕加索的这幅画非常|，让人看不懂|L-传统义：艺术风格，不是网络用语的荒诞|abstract,art,style,painting,non-representational"
  "打工人|这台机器人可以替代|完成重复性劳动|L-中性/字面义：泛指劳动者，不含自嘲|worker,laborer,employee,replace,automat"
  "上价值|这套邮票随着年份增长不断|，现在已经翻了十倍|L-字面义：价格上涨/增值，不是道德绑架|appreciat,value,increase,price,worth"
)

TOTAL=${#CASES[@]}
PASS=0
PARTIAL=0
FAIL=0
INCOMPLETE=0

echo ""
echo ">>> 开始评测，共 ${TOTAL} 条用例 ..."
echo ">>> 结果写入 $RESULTS_FILE"
echo ">>> 评分: PASS=结构+准确 | PARTIAL=仅结构 | FAIL=错误 | INCOMPLETE=缺字段"
echo ""

echo "[]" > "$RESULTS_FILE"

for CASE in "${CASES[@]}"; do
  IFS='|' read -r TEXT PREFIX SUFFIX NOTE KEYWORDS <<< "$CASE"
  CATEGORY="${NOTE%%-*}"

  echo -n "  [${CATEGORY}] ${TEXT:0:20} ... "

  # Build JSON body — use python3 for safe JSON escaping
  JSON_BODY=$(python3 -c "
import json, sys
d = {'text': '''$TEXT''', 'lang': 'zh'}
pfx = '''$PREFIX'''
sfx = '''$SUFFIX'''
if pfx: d['prefix'] = pfx
if sfx: d['suffix'] = sfx
print(json.dumps(d, ensure_ascii=False))
" 2>/dev/null)

  if [ -z "$JSON_BODY" ]; then
    JSON_BODY="{\"text\":\"$TEXT\",\"lang\":\"zh\"}"
  fi

  # 发请求
  RESP=$(curl -s -X POST "$API/api/v1/analyze" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$JSON_BODY")

  # 结构检查
  HAS_ZH=$(echo "$RESP" | grep -c '"zh"' || true)
  HAS_EN=$(echo "$RESP" | grep -c '"en"' || true)
  HAS_IMPL=$(echo "$RESP" | grep -c '"implication"' || true)
  HAS_ERROR=$(echo "$RESP" | grep -c '"error"' || true)
  STRUCT_OK=false
  if [ "$HAS_ERROR" -eq 0 ] && [ "$HAS_ZH" -gt 0 ] && [ "$HAS_EN" -gt 0 ] && [ "$HAS_IMPL" -gt 0 ]; then
    STRUCT_OK=true
  fi

  # 准确性检查：关键词匹配 implication + en + definition
  ACCURACY_OK=false
  MATCHED_KW=""
  if [ "$STRUCT_OK" = true ] && [ -n "$KEYWORDS" ]; then
    MATCHED_KW=$(python3 -c "
import json, re, sys
try:
    resp = json.loads('''$RESP''')
    search_text = ' '.join([
        resp.get('implication',''),
        resp.get('en',''),
        resp.get('definition','')
    ]).lower()
    keywords = '''$KEYWORDS'''.split(',')
    matched = [kw.strip() for kw in keywords if re.search(kw.strip().replace(' ','.*'), search_text, re.IGNORECASE)]
    if matched:
        print(','.join(matched[:3]))
except:
    pass
" 2>/dev/null)
    if [ -n "$MATCHED_KW" ]; then
      ACCURACY_OK=true
    fi
  elif [ "$STRUCT_OK" = true ] && [ -z "$KEYWORDS" ]; then
    # no keywords defined → struct pass is enough
    ACCURACY_OK=true
  fi

  # 最终判定
  MODEL=$(echo "$RESP" | grep -o '"model":"[^"]*"' | cut -d'"' -f4 || echo "?")
  SENTIMENT=$(echo "$RESP" | grep -o '"sentiment":"[^"]*"' | cut -d'"' -f4 || echo "?")

  if [ "$HAS_ERROR" -gt 0 ]; then
    STATUS="ERROR"
    FAIL=$((FAIL+1))
    echo "ERROR  (${RESP:0:80})"
  elif [ "$STRUCT_OK" = false ]; then
    STATUS="INCOMPLETE"
    INCOMPLETE=$((INCOMPLETE+1))
    echo "INCOMPLETE  (缺少字段)"
  elif [ "$ACCURACY_OK" = true ]; then
    STATUS="PASS"
    PASS=$((PASS+1))
    echo "PASS  (model:$MODEL  kw:$MATCHED_KW)"
  else
    STATUS="PARTIAL"
    PARTIAL=$((PARTIAL+1))
    echo "PARTIAL  (model:$MODEL  结构OK但关键词未命中)"
  fi

  # 追加到结果文件
  python3 -c "
import json, sys
try:
    data = json.load(open('$RESULTS_FILE'))
except:
    data = []
try:
    resp_obj = json.loads('''$RESP''')
except:
    resp_obj = {'raw': '''${RESP:0:500}'''}
data.append({
    'text': '''$TEXT''',
    'category': '$CATEGORY',
    'note': '''$NOTE''',
    'status': '$STATUS',
    'keywords_expected': '''$KEYWORDS''',
    'keywords_matched': '''$MATCHED_KW''',
    'model': '''$MODEL''',
    'response': resp_obj
})
json.dump(data, open('$RESULTS_FILE','w'), ensure_ascii=False, indent=2)
" 2>/dev/null || true

  sleep "$SLEEP_SEC"
done

echo ""
echo "============================================"
echo "  评测完成 (共 $TOTAL 条)"
echo "    PASS     : $PASS   (结构+准确)"
echo "    PARTIAL  : $PARTIAL   (结构OK 准确不足)"
echo "    INCOMPLETE: $INCOMPLETE   (缺少字段)"
echo "    ERROR    : $FAIL   (请求报错)"
echo ""
ACCURACY_RATE=0
if [ $((PASS + PARTIAL)) -gt 0 ]; then
  ACCURACY_RATE=$(python3 -c "print(f'{$PASS/($PASS+$PARTIAL)*100:.1f}')" 2>/dev/null || echo "?")
fi
STRUCT_RATE=$(python3 -c "print(f'{($PASS+$PARTIAL)/$TOTAL*100:.1f}')" 2>/dev/null || echo "?")
echo "  结构通过率: ${STRUCT_RATE}%"
echo "  准确率:     ${ACCURACY_RATE}%  (在结构通过基础上)"
echo "  详细结果: $RESULTS_FILE"
echo "============================================"
echo ""
echo "--- 按类别汇总 ---"
python3 -c "
import json
data = json.load(open('$RESULTS_FILE'))
cats = {}
for item in data:
    c = item['category']
    s = item['status']
    if c not in cats:
        cats[c] = {'PASS':0,'PARTIAL':0,'INCOMPLETE':0,'ERROR':0,'total':0}
    cats[c][s] = cats[c].get(s,0) + 1
    cats[c]['total'] += 1
cat_labels = {
    'A':'网络流行语', 'B':'反讽弦外音', 'C':'情绪表达',
    'D':'社会现象词', 'E':'完整语句', 'N':'嘈杂上下文',
    'M':'无/极少上下文', 'L':'字面义歧义'
}
print(f'  {\"类别\":<4} {\"说明\":<12} {\"通过\":<6} {\"部分\":<6} {\"缺字段\":<6} {\"错误\":<6} {\"准确率\":<8}')
print('  ' + '-'*56)
for c in sorted(cats.keys()):
    v = cats[c]
    label = cat_labels.get(c, c)
    acc = f'{v[\"PASS\"]/max(v[\"PASS\"]+v[\"PARTIAL\"],1)*100:.0f}%'
    print(f'  {c:<4} {label:<12} {v[\"PASS\"]:<6} {v[\"PARTIAL\"]:<6} {v[\"INCOMPLETE\"]:<6} {v[\"ERROR\"]:<6} {acc:<8}')
" 2>/dev/null
echo ""
echo "--- 查看 PARTIAL 项 (结构OK准确不足，需人工检查) ---"
echo "  python3 -c \"import json; [print(f\\\"  {i['category']}: {i['text'][:15]}  期望:{i['keywords_expected']}  \\\") for i in json.load(open('$RESULTS_FILE')) if i['status']=='PARTIAL']\""
echo ""
echo "--- 查看某条完整响应 (例如 '内卷') ---"
echo "  python3 -c \"import json; [print(json.dumps(i,ensure_ascii=False,indent=2)) for i in json.load(open('$RESULTS_FILE')) if '内卷' in i['text']]\""
