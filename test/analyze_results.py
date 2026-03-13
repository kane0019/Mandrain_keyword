#!/usr/bin/env python3
"""Quick analysis of eval_results.json"""
import json, sys, os

path = os.path.join(os.path.dirname(__file__), '..', 'eval_results.json')
if not os.path.exists(path):
    path = 'eval_results.json'
data = json.load(open(path))
print(f'Total cases: {len(data)}\n')

statuses = {}
for item in data:
    s = item['status']
    statuses[s] = statuses.get(s, 0) + 1
print('=== Overall Status ===')
for s, c in sorted(statuses.items()):
    print(f'  {s}: {c}')

print('\n=== Model Distribution ===')
models = {}
for item in data:
    m = item.get('model', '?')
    models[m] = models.get(m, 0) + 1
for m, c in sorted(models.items()):
    print(f'  {m}: {c}')

print('\n=== INCOMPLETE / ERROR Items ===')
for item in data:
    if item['status'] in ('INCOMPLETE', 'ERROR'):
        resp_msg = item.get('response', {}).get('message', '?')
        txt = item['text'][:25].ljust(25)
        print(f'  [{item["category"]}] {txt} model={item["model"]:<15} resp={resp_msg}')

print('\n=== PARTIAL Items (struct OK, keywords missed) ===')
for item in data:
    if item['status'] == 'PARTIAL':
        resp = item.get('response', {})
        txt = item['text'][:25].ljust(25)
        print(f'  [{item["category"]}] {txt} model={item["model"]}')
        print(f'       expected: {item["keywords_expected"]}')
        print(f'       en={resp.get("en","?")}  impl={resp.get("implication","?")}')

print('\n=== Per-Category Summary ===')
cats = {}
for item in data:
    c = item['category']
    if c not in cats:
        cats[c] = {'PASS':0,'PARTIAL':0,'INCOMPLETE':0,'ERROR':0,'total':0}
    cats[c][item['status']] = cats[c].get(item['status'], 0) + 1
    cats[c]['total'] += 1

labels = {'A':'网络流行语','B':'反讽弦外音','C':'情绪表达','D':'社会现象词',
          'E':'完整语句','N':'嘈杂上下文','M':'无/极少上下文','L':'字面义歧义'}
print(f'  {"Cat":<4} {"Type":<12} {"Total":<6} {"PASS":<6} {"PARTIAL":<8} {"Timeout":<8} {"Accuracy":<8}')
print('  ' + '-' * 58)
for c in sorted(cats.keys()):
    v = cats[c]
    struct_ok = v['PASS'] + v['PARTIAL']
    acc = f'{v["PASS"]/max(struct_ok,1)*100:.0f}%' if struct_ok > 0 else 'N/A'
    to = v['INCOMPLETE'] + v['ERROR']
    print(f'  {c:<4} {labels.get(c,"?"):<12} {v["total"]:<6} {v["PASS"]:<6} {v["PARTIAL"]:<8} {to:<8} {acc:<8}')
