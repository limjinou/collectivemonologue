import json
with open('data/articles.json', encoding='utf-8') as f:
    arts = json.load(f)
for i, a in enumerate(arts):
    tk = a.get('title_kr', 'MISSING')
    sk = a.get('summary_kr', 'MISSING')
    print(f"[{i}] title_kr: {tk[:60]}")
    print(f"     summary_kr: {sk[:60]}")
    print()
