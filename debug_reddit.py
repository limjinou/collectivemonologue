"""Debug: run fetch_reddit_comments against a real article title to see if it finds matches."""
import requests, time, re

HEADERS = {"User-Agent": "CollectiveMonologue_Crawler/1.0"}

def fetch_subreddit_hot(subreddit, limit=15):
    url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit={limit}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 200:
            return [c['data'] for c in resp.json().get('data', {}).get('children', [])]
    except Exception as e:
        print(f" error fetching r/{subreddit}: {e}")
    return []

def get_comments(post_id):
    url = f"https://www.reddit.com/comments/{post_id}.json?sort=confidence&limit=5"
    comments = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if len(data) > 1:
                for child in data[1].get('data', {}).get('children', []):
                    if child['kind'] == 't1':
                        body = child['data'].get('body', '')
                        if len(body) > 10 and "[deleted]" not in body:
                            comments.append(body[:100])
    except Exception as e:
        print(f" error fetching comments: {e}")
    return comments

# Test with recent article titles
test_title = "Clint Dyer Set To Direct Hadestown Broadway"
stopwords = {'the','a','an','in','on','at','to','for','of','and','or','is','are','was','will','with','that','this','from','by','as','it','new','its','into','has','have','set'}
title_words = set(w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', test_title) if w.lower() not in stopwords)
print(f"Title keywords: {title_words}\n")

subreddits = ['Broadway', 'theater', 'movies', 'boxoffice']
best_post = None
best_score = 0

for sub in subreddits:
    posts = fetch_subreddit_hot(sub, 20)
    print(f"r/{sub}: {len(posts)} posts")
    for p in posts:
        pt = p.get('title', '')
        pw = set(w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', pt))
        overlap = len(title_words & pw)
        if overlap > 0:
            print(f"  overlap={overlap}: {pt[:60]}")
        if overlap > best_score:
            best_score = overlap
            best_post = p
            best_post['_sub'] = sub
    time.sleep(0.5)

print(f"\nBest match: overlap={best_score}")
if best_post:
    print(f"  Post: {best_post.get('title','')[:60]} (r/{best_post.get('_sub','')})")
    comments = get_comments(best_post['id'])
    print(f"  Comments ({len(comments)}):")
    for c in comments[:2]:
        print(f"    - {c[:100]}")
