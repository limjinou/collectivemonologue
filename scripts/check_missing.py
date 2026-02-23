import json

with open('data/articles.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

missing = []
for i, a in enumerate(data):
    if '용어 한 스푼' not in a.get('content_kr', ''):
        missing.append((i, a['original_title']))

print(f"Total missing: {len(missing)}")
for i, title in missing:
    print(f"[{i}] {title}")
