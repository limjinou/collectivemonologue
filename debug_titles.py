import json

with open('data/articles.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i, a in enumerate(data):
    has_term = '용어 한 스푼' in a.get('content_kr', '')
    print(f"[{i}] {a['original_title']} | TERM: {has_term}")
