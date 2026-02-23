"""Quick test: see what Reddit returns when we search for a theater article."""
import requests, json, time

HEADERS = {"User-Agent": "CollectiveMonologue_Crawler/1.0"}

# 테스트용 기사 제목 (Playbill에서 자주 나오는 브로드웨이 뉴스 키워드)
test_title = "Broadway New Season"

# 1단계: 우선 URL 방식 (거의 안 걸림 - 디버그 확인용)
q1 = f'url:"https://www.playbill.com" Broadway'
r1 = requests.get(f"https://www.reddit.com/search.json?q={requests.utils.quote(q1)}&sort=top&t=month&limit=3", headers=HEADERS, timeout=10)
print(f"URL-based search status: {r1.status_code}")
if r1.status_code == 200:
    hits1 = r1.json().get('data', {}).get('children', [])
    print(f"  found {len(hits1)} posts")
    for h in hits1[:2]:
        print(f"  >> {h['data']['title'][:60]}")

time.sleep(1)

# 2단계: 제목 기반 검색
clean = "Broadway Season Theater"
q2 = f'"{clean}" subreddit:Broadway'
r2 = requests.get(f"https://www.reddit.com/search.json?q={requests.utils.quote(q2)}&sort=top&t=month&limit=3", headers=HEADERS, timeout=10)
print(f"\nTitle-based search status: {r2.status_code}")
if r2.status_code == 200:
    hits2 = r2.json().get('data', {}).get('children', [])
    print(f"  found {len(hits2)} posts")
    for h in hits2[:2]:
        print(f"  >> {h['data']['title'][:60]}")

time.sleep(1)

# 3단계: 서브레딧 직접 검색 (r/Broadway 최신 글들)
r3 = requests.get("https://www.reddit.com/r/Broadway/hot.json?limit=5", headers=HEADERS, timeout=10)
print(f"\nr/Broadway hot status: {r3.status_code}")
if r3.status_code == 200:
    hits3 = r3.json().get('data', {}).get('children', [])
    print(f"  found {len(hits3)} posts")
    for h in hits3[:3]:
        print(f"  >> [{h['data']['id']}] {h['data']['title'][:60]}")
