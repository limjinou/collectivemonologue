import json

with open('data/articles.json', encoding='utf-8') as f:
    articles = json.load(f)

print(f"Total articles: {len(articles)}")
for a in articles:
    reaction = a.get('reddit_reaction_kr', 'MISSING')
    has_reaction = bool(reaction and reaction.strip())
    print(f"[{a['source']}] has_reddit: {'✅ YES' if has_reaction else '❌ NO'} — {repr(reaction[:80]) if has_reaction else 'empty'}")
