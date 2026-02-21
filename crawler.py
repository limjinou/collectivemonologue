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

RSS_FEEDS = {
    # 연극 특화 소스만 유지 (현재 Playbill RSS 등 일부 피드가 비어있을 수 있어 복수로 추가)
    "Deadline Theater": "https://deadline.com/v/theater/feed/",
    "Playbill": "https://www.playbill.com/rss",
    "BroadwayWorld": "https://www.broadwayworld.com/rss/news.xml"
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
    Here is an article about '{title}'.
    Please extract the core information and rewrite it in Korean.
    The goal is to provide a professional summary of the hottest issues, highly anticipated shows, or upcoming works in the US theater scene.
    
    Format the output as the following JSON. 
    Make sure to write 'title_kr', 'summary_kr', and 'content_kr' in KOREAN:
    {{
        "title_kr": "한국어로 번역/각색된 기사 제목",
        "summary_kr": "리스트 메인 화면에 들어갈 1-2문장의 흥미로운 요약 (한국어)",
        "content_kr": "기사 본문 내용. 문단을 나누어 가독성 좋게 작성 (한국어).",
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

def process_entry(entry, source):
    """Process individual article (for parallel execution)"""
    title = entry.title
    link = entry.link
    published = entry.get('published', datetime.now().strftime("%Y-%m-%d"))
    
    print(f"   Analyzing: {title[:30]}...")

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

def save_to_json(new_data):
    file_path = 'data/articles.json'
    
    # 프로토타입 단계: 모든 기존 데이터 지우고 새로 가져온 딱 2개만 유지
    final_data = new_data[:2]

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)
    print(f"✅ 데이터 덮어쓰기 완료 (총 {len(final_data)}건의 핫이슈 기사 유지)")

def crawl_rss():
    print("🚀 고성능 크롤러(ver.1) 시작...")
    
    all_entries = []
    for source, url in RSS_FEEDS.items():
        print(f"📡 {source} 검색 중...")
        feed = feedparser.parse(url)
        # 각 소스별 최신 2개만 수집
        for entry in feed.entries[:2]:
            all_entries.append((entry, source))
    
    print(f"총 {len(all_entries)}개의 기사 발견. 병렬 처리 시작...")

    results = []
    # 병렬 처리 (최대 2개 동시 작업 - Rate Limit 방지)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_to_entry = {executor.submit(process_entry, entry, source): (entry, source) for entry, source in all_entries}
        for future in concurrent.futures.as_completed(future_to_entry):
            try:
                data = future.result()
                results.append(data)
            except Exception as exc:
                print(f"❌ 처리 중 에러 발생: {exc}")

    return results

if __name__ == "__main__":
    crawled_data = crawl_rss()
    if crawled_data:
        save_to_json(crawled_data)
        send_email(crawled_data)
    else:
        print("새로운 기사가 없습니다.")
