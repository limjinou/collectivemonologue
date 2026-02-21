import feedparser
import smtplib
from email.mime.text import MIMEText
import os
import google.generativeai as genai
from datetime import datetime
from dotenv import load_dotenv
import json
import trafilatura
import concurrent.futures
import time

# 1. 환경 변수 로드
load_dotenv()

# API 키 및 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
EMAIL_SENDER = os.getenv("EMAIL_SENDER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
EMAIL_RECEIVER = os.getenv("EMAIL_RECEIVER")

# Gemini 설정
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    # Flash Latest 사용 (Stable version, quota friendly)
    model = genai.GenerativeModel('gemini-flash-latest')

# 메이저 소스 (브로드웨이 / 할리우드 메이저)
MAJOR_FEEDS = {
    "Playbill": "https://www.playbill.com/rss",
    "BroadwayWorld": "https://www.broadwayworld.com/rss/news.xml",
    "Deadline Theater": "https://deadline.com/v/theater/feed/",
}

# 인디 소스 (대학로 감성, 비영리, 소규모 극장)
INDIE_FEEDS = {
    "American Theatre": "https://www.americantheatre.org/feed/",
    "TheaterMania": "https://www.theatermania.com/rss",
}

def fetch_article_content(url):
    """Trafilatura를 사용하여 기사 본문 추출"""
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded)
            return text
    except Exception as e:
        print(f"⚠️ 본문 추출 실패 ({url}): {e}")
    return None

def translate_and_summarize(text, title):
    if not GEMINI_API_KEY:
        return {"title_en": title, "summary_en": "No API Key provided.", "keywords": []}

    if not text or len(text) < 50:
        return {"title_en": title, "summary_en": "Content too short or extraction failed.", "keywords": []}
    
    # 너무 긴 텍스트는 잘라서 보냄 (토큰 제한 방지)
    truncated_text = text[:4000]

    prompt = f"""
    You are the editor of "Collective Monologue", a Korean-language magazine dedicated to covering American theater and film with depth, nuance, and cultural context.
    
    Below is an article titled '{title}'. Your task is NOT a simple translation.
    Instead, produce a rich, original Korean editorial that:

    1. Summarizes the core news from the article
    2. Adds meaningful background knowledge YOU ALREADY KNOW about:
       - Any ACTORS or DIRECTORS mentioned: their notable past works, career highlights, and what makes them significant
       - Any PRODUCTIONS or PLAYS mentioned: the original playwright, a brief synopsis, the work's historical/cultural significance
       - Any THEATERS or VENUES mentioned: their location, founding history, notable past productions, or their role in American theater
       - Any AWARDS or EVENTS mentioned: the history and significance of the award or event
    3. Includes a brief editorial perspective or "editor's note" that helps Korean readers understand WHY this news matters in the context of American theater/film culture

    Write as a knowledgeable Korean cultural journalist — warm, insightful, and informative.
    The output must be a JSON object with KOREAN text for title_kr, summary_kr, and content_kr:
    {{
        "title_kr": "한국 독자의 흥미를 끌 수 있는 매력적인 기사 제목 (한국어)",
        "summary_kr": "메인 페이지 리스트에 표시될 1-2문장의 핵심 요약. 독자가 클릭하고 싶게 만들어라 (한국어)",
        "content_kr": "기사 본문. 뉴스 요약 + 등장 인물/작품/공연장에 대한 배경 지식을 자연스럽게 녹인 풍부한 텍스트. 문단을 나누어 가독성 좋게 작성. 마지막엔 '편집자 주' 또는 한국 독자를 위한 맥락 설명 한 문단을 추가할 것 (한국어)",
        "keywords": ["키워드1", "키워드2", "키워드3"]
    }}

    Article Body:
    {truncated_text}
    """

    # 재시도 로직 (Exponential Backoff)
    max_retries = 3
    base_delay = 5  # 5초부터 시작

    for attempt in range(max_retries):
        try:
            response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(response.text)
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                wait_time = base_delay * (2 ** attempt) + (attempt * 2) # Jitter 추가
                print(f"⚠️ Quota exceeded. Retrying in {wait_time}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
            else:
                print(f"⚠️ Summary failed (API Error): {e}")
                break
    
    return {
        "title_kr": title,
        "summary_kr": "요약 생성 중 오류가 발생했습니다.",
        "content_kr": "내용을 불러올 수 없습니다.",
        "keywords": []
    }

def process_entry(entry, source, tier):
    """Process individual article (for parallel execution)"""
    title = entry.title
    link = entry.link
    published = entry.get('published', datetime.now().strftime("%Y-%m-%d"))
    
    print(f"   Analyzing [{tier.upper()}]: {title[:30]}...")

    # 1. Extract full text
    full_text = fetch_article_content(link)
    
    # 2. AI Summary
    ai_result = translate_and_summarize(full_text, title)

    # Extract image from entry or feed
    image_url = ""
    # Try different common RSS image enclosures
    if 'media_content' in entry and len(entry.media_content) > 0:
        image_url = entry.media_content[0].get('url', '')
    elif 'media_thumbnail' in entry and len(entry.media_thumbnail) > 0:
        image_url = entry.media_thumbnail[0].get('url', '')
    elif 'links' in entry:
        for link_item in entry.links:
            if link_item.get('type', '').startswith('image/'):
                image_url = link_item.get('href', '')
                break

    return {
        "source": source,
        "tier": tier,  # 'major' 또는 'indie'
        "original_title": title,
        "link": link,
        "image": image_url,
        "title_kr": ai_result.get('title_kr', title),
        "summary_kr": ai_result.get('summary_kr', '내용 없음'),
        "content_kr": ai_result.get('content_kr', '내용 없음'),
        "keywords": ai_result.get('keywords', []),
        "date": published,
        "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def send_email(articles):
    if not EMAIL_SENDER or not EMAIL_PASSWORD or not articles:
        return

    subject = f"[StageSide] Latest News Briefing - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    body = "<h2>Today's Top News</h2><br>"
    
    for article in articles:
        body += f"<h3>[{article['source']}] {article['title_kr']}</h3>"
        body += f"<p>{article['summary_kr']}</p>"
        body += f"<p><small>Keywords: {', '.join(article['keywords'])}</small></p>"
        body += f"<p><a href='{article['link']}' target='_blank'>Read Original</a></p><hr>"

    msg = MIMEText(body, 'html')
    msg['Subject'] = subject
    msg['From'] = EMAIL_SENDER
    msg['To'] = EMAIL_RECEIVER

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)
        print(f"📧 이메일 레포트 발송 완료 ({len(articles)}건)")
    except Exception as e:
        print(f"❌ 이메일 발송 실패: {e}")

def save_to_json(major_articles, indie_articles):
    file_path = 'data/articles.json'
    
    # 메이저 2개 + 인디 2개 유지
    final_data = major_articles[:2] + indie_articles[:2]

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)
    print(f"✅ 저장 완료: 메이저 {len(major_articles[:2])}건 + 인디 {len(indie_articles[:2])}건 = 총 {len(final_data)}건")

def crawl_rss():
    print("🚀 크롤러(ver.2) 시작 — 메이저 2건 + 인디 2건 수집")
    
    def fetch_from_feeds(feeds_dict, tier):
        entries = []
        for source, url in feeds_dict.items():
            print(f"📡 [{tier.upper()}] {source} 검색 중...")
            try:
                feed = feedparser.parse(url)
                # 각 소스별 최신 1개씩 수집
                for entry in feed.entries[:1]:
                    entries.append((entry, source, tier))
            except Exception as e:
                print(f"⚠️ {source} 피드 오류: {e}")
        return entries

    major_entries = fetch_from_feeds(MAJOR_FEEDS, 'major')
    indie_entries = fetch_from_feeds(INDIE_FEEDS, 'indie')
    all_entries = major_entries + indie_entries
    
    print(f"총 {len(all_entries)}개 기사 발견. 병렬 처리 시작...")

    major_results = []
    indie_results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_to_entry = {
            executor.submit(process_entry, entry, source, tier): (entry, source, tier)
            for entry, source, tier in all_entries
        }
        for future in concurrent.futures.as_completed(future_to_entry):
            try:
                data = future.result()
                if data['tier'] == 'major':
                    major_results.append(data)
                else:
                    indie_results.append(data)
            except Exception as exc:
                print(f"❌ 처리 중 에러 발생: {exc}")

    return major_results, indie_results

if __name__ == "__main__":
    major_data, indie_data = crawl_rss()
    if major_data or indie_data:
        save_to_json(major_data, indie_data)
        all_data = major_data + indie_data
        send_email(all_data)
    else:
        print("새로운 기사가 없습니다.")
