import feedparser
import smtplib
from email.mime.text import MIMEText
import os
import google.generativeai as genai
from datetime import datetime
from dotenv import load_dotenv
import json

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
    model = genai.GenerativeModel('gemini-2.0-flash')

RSS_FEEDS = {
    "Variety": "https://variety.com/feed/",
    "Deadline": "https://deadline.com/feed/"
}

def translate_and_summarize(text):
    if not GEMINI_API_KEY:
        return f"[번역 불가] API 키가 없습니다. (원문) {text[:100]}..."
    
    try:
        prompt = f"다음 영어 기사 제목과 요약을 한국어로 번역하고, 간략하게 핵심만 요약해줘. 형식은 '제목: [제목]', '요약: [내용]' 으로 해줘.\n\n{text}"
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        print(f"⚠️ 번역 실패 (API Error): {e}")
        return text  # 번역 실패 시 원문 반환

def send_email(articles):
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print("⚠️ 이메일 설정이 없어 메일을 보내지 않습니다.")
        return

    subject = f"[StageSide] 최신 뉴스 요약 - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    body = "<h2>오늘의 주요 뉴스</h2><br>"
    
    for article in articles:
        source = article.get('source', 'Playbill/Unknown')
        title = article.get('title', 'No Title')
        link = article.get('link', '#')
        summary = article.get('summary_kr', '요약 없음')
        
        body += f"<h3>{title} ({source})</h3>"
        body += f"<p><b>원문 링크:</b> <a href='{link}'>{link}</a></p>"
        body += f"<p>{summary.replace('\n', '<br>')}</p><hr>"

    msg = MIMEText(body, 'html')
    msg['Subject'] = subject
    msg['From'] = EMAIL_SENDER
    msg['To'] = EMAIL_RECEIVER

    try:
        # Gmail SMTP (App Password 사용 권장)
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)
        print(f"📧 이메일 발송 성공! ({EMAIL_RECEIVER})")
    except Exception as e:
        print(f"❌ 이메일 발송 실패: {e}")

import time

def crawl_rss():
    articles = []
    print("🔄 RSS 피드 크롤링 시작...")
    
    for source, url in RSS_FEEDS.items():
        print(f"📡 {source} 가져오는 중...")
        feed = feedparser.parse(url)
        
        # 최신 3개만 가져오기
        for entry in feed.entries[:3]:
            title = entry.title
            link = entry.link
            summary = entry.description if 'description' in entry else entry.title
            
            print(f"   - 발견: {title[:30]}...")
            
            # 번역 및 요약
            content_to_translate = f"Title: {title}\nSummary: {summary}"
            translated_text = translate_and_summarize(content_to_translate)
            
            articles.append({
                "source": source,
                "title": title,
                "link": link,
                "summary_kr": translated_text,
                "date": datetime.now().strftime("%Y-%m-%d")
            })
            time.sleep(10) # Rate Limit 방지
            
    return articles

def save_to_json(new_data):
    file_path = 'data/articles.json'
    
    all_data = []
    # 기존 데이터 있다면 로드
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            try:
                existing = json.load(f)
                all_data.extend(new_data)
                all_data.extend(existing) 
            except json.JSONDecodeError:
                all_data = new_data
    else:
        all_data = new_data
    
    # 중복 제거 (링크 기준)
    seen_links = set()
    unique_data = []
    for item in all_data:
        link = item.get('link')
        if link and link not in seen_links:
            unique_data.append(item)
            seen_links.add(link)

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(unique_data[:20], f, ensure_ascii=False, indent=4) # 최대 20개 유지
    print("✅ data/articles.json 저장 완료")

if __name__ == "__main__":
    crawled_data = crawl_rss()
    if crawled_data:
        save_to_json(crawled_data)
        send_email(crawled_data)
        print("🎉 모든 작업 완료!")
