"""
더 강력한 이미지 패치 — 추적 픽셀 URL도 감지해서 Wikipedia로 교체
"""
import json, requests, re, time

HEADERS = {"User-Agent": "CollectiveMonologue/1.0"}

# 실제 이미지가 아닌 URL 패턴
BAD_IMAGE_PATTERNS = [
    "scorecardresearch.com",
    "pixel",
    "1x1",
    "tracking",
    "beacon",
    "analytics",
    ".gif",
]

def is_bad_image(url):
    if not url:
        return True
    return any(p in url.lower() for p in BAD_IMAGE_PATTERNS)

def fetch_wikipedia_image(keywords):
    for keyword in keywords[:6]:
        keyword = str(keyword).strip()
        if not keyword or len(keyword) < 3:
            continue
        try:
            url = (
                "https://en.wikipedia.org/w/api.php"
                f"?action=query&titles={requests.utils.quote(keyword)}"
                "&prop=pageimages&format=json&pithumbsize=800"
            )
            resp = requests.get(url, timeout=6, headers=HEADERS)
            data = resp.json()
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                thumb = page.get("thumbnail", {}).get("source", "")
                if thumb:
                    print(f"   ✅ Wikipedia 이미지: [{keyword}] → {thumb[:60]}")
                    return thumb
        except Exception as e:
            print(f"   ⚠️ {keyword}: {e}")
        time.sleep(0.3)
    return ""

def extract_keywords_from_title(title):
    """원문 제목에서 고유명사 + 단어 조합 추출"""
    # 2개 이상 단어로 된 대문자 시작 구문
    phrases = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+', title)
    # 단일 대문자 단어 (4글자 이상)
    singles = re.findall(r'\b[A-Z][a-z]{3,}\b', title)
    # 전체 제목도 추가
    all_kw = phrases + singles
    if not all_kw:
        # 영문자 단어만 추출
        words = re.findall(r'[A-Za-z]{4,}', title)
        all_kw = words
    return all_kw

with open("data/articles.json", encoding="utf-8") as f:
    articles = json.load(f)

patched = 0
for i, article in enumerate(articles):
    img = article.get("image", "")
    if is_bad_image(img):
        print(f"\n[{i}] 교체 필요: {article.get('original_title','')[:55]}")
        print(f"   현재 이미지: {img[:60] if img else '없음'}")

        title = article.get("original_title", "")
        kw_title = extract_keywords_from_title(title)
        kw_data = [str(k) for k in article.get("keywords", [])]
        search_kw = list(dict.fromkeys(kw_title + kw_data))  # 중복 제거
        print(f"   검색 키워드: {search_kw[:5]}")

        new_img = fetch_wikipedia_image(search_kw)
        if new_img:
            articles[i]["image"] = new_img
            patched += 1
        else:
            print(f"   ❌ Wikipedia 이미지 없음 — 빈 값으로 유지")
            articles[i]["image"] = ""
    else:
        print(f"[{i}] OK: {img[:60]}")

with open("data/articles.json", "w", encoding="utf-8") as f:
    json.dump(articles, f, ensure_ascii=False, indent=4)

print(f"\n✅ 완료: {patched}개 기사에 이미지 패치")
