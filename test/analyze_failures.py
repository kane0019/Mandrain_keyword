import json, sys

with open("eval_results.json", "r") as f:
    data = json.load(f)

total = len(data)
by_status = {}
for item in data:
    s = item["status"]
    by_status.setdefault(s, []).append(item)

print(f"Total: {total}")
for s in ["PASS", "PARTIAL", "INCOMPLETE", "FAIL", "ERROR"]:
    if s in by_status:
        print(f"  {s}: {len(by_status[s])}")

print("\n=== NON-PASS CASES ===\n")
for item in data:
    if item["status"] == "PASS":
        continue
    print(f"[{item['status']}] [{item['category']}] \"{item['text']}\"")
    print(f"  note: {item['note']}")
    if item.get("keywords_expected"):
        print(f"  expected kw: {item['keywords_expected']}")
        print(f"  matched kw:  {item['keywords_matched']}")
    resp = item.get("response", {})
    if isinstance(resp, dict):
        if resp.get("error"):
            print(f"  ERROR: {resp['error']}: {resp.get('message','')}")
        else:
            print(f"  en:         {resp.get('en','')}")
            print(f"  definition: {resp.get('definition','')}")
            print(f"  implication:{resp.get('implication','')}")
            print(f"  sentiment:  {resp.get('sentiment','')}")
            print(f"  model:      {resp.get('model','')}")
            print(f"  source:     {resp.get('source','')}")
    else:
        print(f"  response: {str(resp)[:300]}")
    print()
