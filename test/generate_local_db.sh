#!/usr/bin/env bash
# =============================================================
# generate_local_db.sh — 批量调用 analyze API 生成本地词库
#
# 使用方法：
#   1. 设置 API 和 LICENSE_TOKEN（需要付费 plan 的 token）
#   2. bash test/generate_local_db.sh
#   3. 结果写入 extension/local_db.json
#
# 此脚本调用 model 逐条分析词汇，收集结果构建本地词库。
# 运行一次即可，本地词库覆盖常见词后，大部分查询不再需要 model。
# =============================================================

set -euo pipefail

API="https://zeesoi54x2.execute-api.us-east-1.amazonaws.com/v1"
LICENSE_TOKEN="test-license-001"
INSTALL_ID="eval-device-001"
OUTPUT_FILE="extension/local_db.json"
SLEEP_SEC=2   # 间隔稍长，避免限流

# 获取 JWT
echo ">>> 获取 access_token ..."
INIT_RESP=$(curl -s -X POST "$API/api/v1/session/init" \
  -H "Content-Type: application/json" \
  -d "{\"license_token\":\"$LICENSE_TOKEN\",\"install_id\":\"$INSTALL_ID\",\"client_version\":\"gen-1.0\",\"platform\":\"eval\"}")

TOKEN=$(echo "$INIT_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: 获取 token 失败。响应: $INIT_RESP"
  exit 1
fi
echo "    token 已获取"

# ---- 词汇表 ----
# 常见中文网络用语、俚语、社会现象词
# 每个词带一句典型上下文(prefix|suffix)帮助 model 给出最佳俚语含义
declare -a WORDS=(
  # 网络流行语
  "内卷|大家都在拼命加班|，谁也不敢先走"
  "躺平|与其拼死拼活，不如直接|，爱咋咋地"
  "破防|看到他的告别信，我直接|了"
  "凡尔赛|她又在朋友圈|了，说老公送的包太多放不下"
  "抽象|这个主播的操作真的太|了，笑死"
  "典中典|这个回复属于是|了，经典到不行"
  "有点东西|这个新人表现|啊，刮目相看"
  "这波属于|大盘跌的时候他满仓抄底，|神操作了"
  "摆烂|反正考不过了，直接|吧"
  "绝绝子|这个甜品真的|，太好吃了"
  "yyds|这首歌真的是|，百听不厌"
  "emo|今天又|了，感觉好丧"
  "佛系|他做事一直很|，不争不抢"
  "鸡娃|现在的家长都在|，孩子压力好大"
  "海王|他同时跟好几个人暧昧，就是个|"
  "绿茶|她表面人畜无害，其实是个|"
  "白莲花|她装的跟|一样，其实心机很重"
  "舔狗|他在她面前就是个|，毫无底线"
  "渣男|这种|就应该被曝光"
  "渣女|她玩弄别人感情，标准|"
  "杠精|评论区总有|，什么都要反驳"
  "键盘侠|这些|只会在网上逞能"
  "喷子|网上到处是|，说话特别难听"
  "网暴|他被|了，心理压力很大"
  "吃瓜|这个八卦我要|看看"
  "瓜|这个|好大，你听说了吗"
  "带节奏|有人在评论区|，大家别上当"
  "水军|这条新闻下面全是|"
  "刷屏|这个话题直接|了整个朋友圈"
  "出圈|这首歌已经|了，连不追星的人都在听"
  "塌房|偶像|了，粉丝都在脱粉"
  "脱粉|看到他的丑闻后我直接|了"
  "回踩|她|前任男友，说了很多难听的话"
  "拉踩|粉丝之间互相|，没有意义"

  # 反讽 / 弦外之音
  "你品，你细品|他说他每天只工作四小时，|，真的只有四小时吗"
  "真有你的|你把客户的数据删了？|啊"
  "我哭死|他居然给我买了限量版球鞋，|"
  "他真的很努力|虽然结果不怎么样，但|，态度分给满"
  "离谱|这件事真的太|了，我都无语了"
  "无语|看到这个新闻我直接|了"
  "服了|我真的|你了，这都能做出来"
  "我谢谢你|这种馊主意也想得出来，|啊"
  "好家伙|他一个人吃了三碗饭，|"
  "芜湖|考试全过了，|起飞"
  "笑死|这个段子|我了"
  "裂开|看到成绩的那一刻我|了"
  "麻了|等了两个小时还没排到，|"

  # 情绪表达
  "上价值|你别动不动就|，吃个饭而已"
  "阴阳怪气|他说话总是|的，让人很不舒服"
  "爹味|他教训人的样子真的|十足"
  "PUA|她男朋友一直在|她，让她觉得自己什么都不行"
  "窒息|这个工作环境让人感觉太|了"
  "上头|这首歌太|了，单曲循环停不下来"
  "下头|他一开口说话就让人|"
  "心动|看到她笑的那一刻，|了"
  "意难平|这个结局让人|"
  "破大防|这个视频让我直接|了"

  # 社会现象词
  "打工人|早安|！干饭人，干饭魂"
  "韭菜|散户又被割|了，庄家赚麻了"
  "卷王|他每天学到凌晨三点，是我们班的|，太可怕了"
  "社恐|不想参加团建，我|犯了"
  "社牛|他跟谁都能聊得来，典型|"
  "老六|这个人打游戏太|了，专门阴人"
  "显眼包|他在人群中就是个|，特别引人注目"
  "i人|我是典型的|，聚会就想躲角落"
  "e人|她是个|，到哪都能交到朋友"
  "搭子|我需要一个吃饭|"
  "牛马|每天加班到深夜，活得像|一样"
  "特种兵旅游|用最少的时间玩最多的景点，|真的累"
  "精神内耗|每天都在|，什么都没做但觉得好累"
  "信息茧房|算法推荐让我们困在|里"
  "数字游民|他辞职后成了|，边旅行边工作"
  "脑暴|我们今天来|一下新方案"
  "对齐|不然我们先把信息|一下"
  "拉通|这件事情要|看一下全链路的问题"

  # 职场 / 商业用语
  "赋能|我们要用AI|业务发展"
  "破局|面对困境，我们必须找到|之道"
  "反思|这次失败值得|"
  "链路|我们要优化整个业务|"
  "颗粒度|这个分析的|太粗了，需要更细"
  "迭代|产品需要不断|优化"
  "快速迭代|我们要|，才能保持竞争力"
  "优化|这个方案还需要进一步|"
  "数字化|企业|转型势在必行"
  "智能化|推动业务|发展"
  "抓手|我们需要找到一个|来推动这件事"
  "赛道|这个|竞争太激烈了"
  "闭环|这个项目需要形成|管理"
  "打法|我们要调整市场|"
  "沉淀|多年的经验|下来不少财富"
  "复盘|项目结束后我们来|一下"

  # 常见俗语 / 日常用语
  "整活|他又开始|了，太搞笑了"
  "整花活|这次的创意属于是|了"
  "拿捏|这个造型被她|住了"
  "心态崩了|连续失败三次，|"
  "天花板|他就是这个行业的|"
  "刺客|超市里的|太多了，结账才发现贵"
  "雪糕刺客|这个|，一根卖66块"
  "夺笋|这个操作真的太|了"
  "种草|被博主|了这款产品"
  "拔草|去了一趟终于|了"
  "安利|朋友|我看这部电影"
  "恰饭|这个博主又在|了"
  "摸鱼|上班偷偷|被发现了"
)

TOTAL=${#WORDS[@]}
SUCCESS=0
FAIL=0

echo ""
echo ">>> 开始生成本地词库，共 ${TOTAL} 个词条 ..."
echo ""

# Start JSON object
python3 -c "import json; json.dump({}, open('${OUTPUT_FILE}', 'w'), ensure_ascii=False, indent=2)"

for ENTRY in "${WORDS[@]}"; do
  IFS='|' read -r TEXT PREFIX SUFFIX <<< "$ENTRY"

  echo -n "  ${TEXT} ... "

  # Build JSON body
  JSON_BODY=$(python3 -c "
import json
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

  RESP=$(curl -s -m 90 -X POST "$API/api/v1/analyze" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$JSON_BODY")

  # Check if valid
  HAS_ZH=$(echo "$RESP" | grep -c '"zh"' || true)
  HAS_EN=$(echo "$RESP" | grep -c '"en"' || true)
  HAS_IMPL=$(echo "$RESP" | grep -c '"implication"' || true)

  if [ "$HAS_ZH" -gt 0 ] && [ "$HAS_EN" -gt 0 ] && [ "$HAS_IMPL" -gt 0 ]; then
    SUCCESS=$((SUCCESS+1))
    MODEL=$(echo "$RESP" | grep -o '"model":"[^"]*"' | cut -d'"' -f4 || echo "?")
    echo "OK (model: $MODEL)"

    # Append to local_db.json
    python3 -c "
import json
db = json.loads(open('${OUTPUT_FILE}', 'rb').read().decode('utf-8-sig'))
resp = json.loads('''$RESP''')
db['''$TEXT'''] = {
    'zh': resp.get('zh', '''$TEXT'''),
    'en': resp.get('en', ''),
    'definition': resp.get('definition', ''),
    'implication': resp.get('implication', ''),
    'sentiment': resp.get('sentiment', 'neutral')
}
json.dump(db, open('${OUTPUT_FILE}', 'w'), ensure_ascii=False, indent=2)
" 2>/dev/null || echo "  (write failed)"
  else
    FAIL=$((FAIL+1))
    echo "FAIL (${RESP:0:60})"
  fi

  sleep "$SLEEP_SEC"
done

echo ""
echo "============================================"
echo "  本地词库生成完成"
echo "    成功: $SUCCESS / $TOTAL"
echo "    失败: $FAIL"
echo "    输出: $OUTPUT_FILE"
echo "============================================"
echo ""
echo "词条数量:"
python3 -c "import json; d=json.loads(open('${OUTPUT_FILE}','rb').read().decode('utf-8-sig')); print(f'  {len(d)} entries')"
