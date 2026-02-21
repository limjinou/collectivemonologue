"""
순차 재번역 스크립트 — 번역 실패한 기사만 Gemini로 재처리
병렬 실행 금지, 기사당 10초 대기로 quota 회피
"""
import json, time, os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")

FAIL_MARKERS = ["정보를 불러오는 중", "내용 없음", "Summarization", "오류", ""]

def needs_translation(article):
    summary = article.get("summary_kr", "")
    title = article.get("title_kr", "")
    # 원문 제목과 같거나 에러 메시지면 재번역 필요
    return (
        not summary or
        any(m in summary for m in FAIL_MARKERS) or
        title == article.get("original_title", "")
    )

def translate(text, title):
    if not text or len(text) < 50:
        return None
    truncated = text[:3000]
    prompt = f"""
You are the editor of "Collective Monologue", a Korean-language magazine covering American theater and film.

Article title: '{title}'

Produce a rich Korean editorial covering:
1. Core news summary
2. Background on mentioned actors, productions, theaters, awards
3. Brief editor's perspective for Korean readers

Output ONLY a JSON object:
{{
    "title_kr": "매력적인 한국어 제목",
    "summary_kr": "1-2문장 핵심 요약 (한국어, 클릭하고 싶게)",
    "content_kr": "풍부한 기사 본문 (한국어, 여러 문단, 마지막에 편집자 주 포함)",
    "reddit_reaction_kr": "",
    "keywords": ["keyword1", "keyword2", "keyword3"]
}}

Article:
{truncated}
"""
    for attempt in range(5):
        try:
            resp = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(resp.text)
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                wait = 30 * (attempt + 1)
                print(f"  ⏳ Quota exceeded — {wait}초 대기 (시도 {attempt+1}/5)")
                time.sleep(wait)
            else:
                print(f"  ❌ API 오류: {e}")
                return None
    return None

# articles.json 로드
with open("data/articles.json", encoding="utf-8") as f:
    articles = json.load(f)

patched = 0
for i, article in enumerate(articles):
    if not needs_translation(article):
        print(f"[{i}] ✅ OK: {article.get('title_kr','')[:40]}")
        continue

    print(f"\n[{i}] 🔄 재번역 필요: {article.get('original_title','')[:50]}")

    # 본문 텍스트 가져오기 (trafilatura 사용)
    import trafilatura
    import requests
    link = article.get("link", "")
    body = ""
    if link:
        try:
            r = requests.get(link, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
            body = trafilatura.extract(r.text) or ""
        except Exception as e:
            print(f"  ⚠️ 본문 추출 실패: {e}")

    result = translate(body or article.get("original_title",""), article.get("original_title",""))
    if result:
        for key in ["title_kr", "summary_kr", "content_kr", "reddit_reaction_kr", "keywords"]:
            if key in result:
                article[key] = result[key]
        articles[i] = article
        patched += 1
        print(f"  ✅ 번역 완료: {result.get('title_kr','')[:40]}")
    else:
        print(f"  ❌ 번역 실패 — 건너뜀")

    # 매 기사마다 저장 (중간에 끊겨도 안전)
    with open("data/articles.json", "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=4)

    print(f"  💾 저장 완료. 10초 대기...")
    time.sleep(10)

print(f"\n✅ 재번역 완료: {patched}개 기사")
