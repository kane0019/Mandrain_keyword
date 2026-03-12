#!/usr/bin/env bash
# =============================================================
# Mandrain Keyword — 中文语义理解评测脚本
# 使用方法：
#   1. 先拿到 session token (见下方 Step 0)
#   2. 填写 API 和 TOKEN
#   3. bash eval_model.sh
#   4. 结果写入 eval_results.json
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
# 格式: "词语|说明"
# 分 5 类：
#   A = 网络流行语
#   B = 反讽/弦外之音
#   C = 情绪表达
#   D = 社会现象词
#   E = 带上下文的语句
declare -a CASES=(
  # --- A: 网络流行语 ---
  "内卷|A-网络流行语，应有社会竞争含义"
  "躺平|A-网络流行语，应有放弃竞争含义"
  "破防|A-网络流行语，应有情绪崩溃含义"
  "凡尔赛|A-网络流行语，应体现显摆/炫耀含义"
  "抽象|A-当代网络用语，不是传统意义的抽象"
  "典中典|A-网络用语，应表示极具代表性/典型"
  "有点东西|A-应表示厉害/出乎意料"
  "这波属于|A-应表示某次操作/行为值得称道"
  # --- B: 反讽/弦外之音 ---
  "你品，你细品|B-提示听者回味，通常暗示有隐情"
  "真有你的|B-可以是赞赏，也可以是反讽，应说明语境"
  "我哭死|B-夸张表达，不是真在哭，应说明情绪夸张用法"
  "他真的很努力|B-字面是夸，但有时是在讽刺"
  # --- C: 情绪类 ---
  "上价值|C-单方面把对话拔高到道德/意义层面，含贬义"
  "阴阳怪气|C-用表面正常的话语暗中讽刺，应说清楚"
  "爹味|C-指说话居高临下、自以为是的男性气质，贬义"
  "PUA|C-在中文语境里含义已扩展，应说明与英文原义差异"
  # --- D: 社会现象词 ---
  "打工人|D-应体现既是自嘲也是团结感"
  "韭菜|D-在金融/商业语境指被割的散户或普通人"
  "卷王|D-努力内卷者，带有戏谑语气"
  "社恐|D-不仅是社交恐惧症，在口语里是轻松自嘲用法"
  # --- E: 带语境的段落 ---
  "领导说大家辛苦了，周末别休息，再冲一冲|E-应识别出反话/压榨含义而非真诚感谢"
  "她说你今天挺会穿的|E-可能是真夸也可能是嘲讽，应分析歧义"
  "他发朋友圈不是分享生活，是在凡尔赛|E-应解释凡尔赛在此处的用法"
)

TOTAL=${#CASES[@]}
PASS=0
FAIL=0

echo ""
echo ">>> 开始评测，共 ${TOTAL} 条用例 ..."
echo ">>> 结果写入 $RESULTS_FILE"
echo ""

echo "[]" > "$RESULTS_FILE"

for CASE in "${CASES[@]}"; do
  TEXT="${CASE%%|*}"
  NOTE="${CASE##*|}"
  CATEGORY="${NOTE%%- *}"

  echo -n "  [${CATEGORY}] ${TEXT} ... "

  # 发请求
  RESP=$(curl -s -X POST "$API/api/v1/analyze" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"text\":\"$TEXT\",\"lang\":\"zh\"}")

  # 基础检查：是否有 zh / en / implication 字段
  HAS_ZH=$(echo "$RESP" | grep -c '"zh"' || true)
  HAS_EN=$(echo "$RESP" | grep -c '"en"' || true)
  HAS_IMPL=$(echo "$RESP" | grep -c '"implication"' || true)
  HAS_SENTIMENT=$(echo "$RESP" | grep -c '"sentiment"' || true)
  HAS_ERROR=$(echo "$RESP" | grep -c '"error"' || true)

  if [ "$HAS_ERROR" -gt 0 ]; then
    STATUS="FAIL"
    FAIL=$((FAIL+1))
    echo "FAIL  (响应: ${RESP:0:80})"
  elif [ "$HAS_ZH" -gt 0 ] && [ "$HAS_EN" -gt 0 ] && [ "$HAS_IMPL" -gt 0 ]; then
    STATUS="PASS"
    PASS=$((PASS+1))
    SENTIMENT=$(echo "$RESP" | grep -o '"sentiment":"[^"]*"' | cut -d'"' -f4 || echo "?")
    echo "PASS  (sentiment: $SENTIMENT)"
  else
    STATUS="INCOMPLETE"
    FAIL=$((FAIL+1))
    echo "INCOMPLETE  (缺少字段)"
  fi

  # 追加到结果文件
  python3 -c "
import json, sys
data = json.load(open('$RESULTS_FILE'))
data.append({
  'text': '$TEXT',
  'category': '$CATEGORY',
  'note': '''$NOTE''',
  'status': '$STATUS',
  'response': $RESP
})
json.dump(data, open('$RESULTS_FILE','w'), ensure_ascii=False, indent=2)
" 2>/dev/null || true

  sleep "$SLEEP_SEC"
done

echo ""
echo "============================================"
echo "  评测完成: $PASS 通过 / $FAIL 失败 / 共 $TOTAL 条"
echo "  详细结果: $RESULTS_FILE"
echo "============================================"
echo ""
echo "查看失败项:"
echo "  python3 -c \"import json; [print(i['text'], '->', i['status']) for i in json.load(open('$RESULTS_FILE')) if i['status']!='PASS']\""
echo ""
echo "查看某条完整响应 (例如 '内卷'):"
echo "  python3 -c \"import json; [print(json.dumps(i['response'],ensure_ascii=False,indent=2)) for i in json.load(open('$RESULTS_FILE')) if i['text']=='内卷']\""
