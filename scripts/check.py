import json
with open('data/articles.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

missing = 0
for i, a in enumerate(data):
    if not a.get('content_kr') or a.get('content_kr') == '본문을 처리하지 못했습니다.':
        print(f"Missing: {i} - {a.get('original_title')}")
        missing += 1
print(f"Total missing: {missing}")
