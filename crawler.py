import feedparser
import smtplib
from email.mime.text import MIMEText
import os
import google.generativeai as genai
from datetime import datetime, timezone
from dotenv import load_dotenv
import json
import trafilatura
import concurrent.futures
import time
import requests
import bs4

# 1. 환경 변수 로드
load_dotenv()

# API 키 및 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
EMAIL_SENDER = os.getenv("EMAIL_SENDER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
EMAIL_RECEIVER = os.getenv("EMAIL_RECEIVER")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "CollectiveMonologue_Crawler/1.0")

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
    "HowlRound": "https://howlround.com/rss.xml",  # 온라인 비영리 연극 매거진 HowlRound
    "TheaterMania": "https://www.theatermania.com/feed/",
}

def fetch_article_content(url):
    """Trafilatura를 사용하여 기사 본문 및 첫 번째 이미지 URL 추출"""
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded)
            # 본문 HTML에서 첫 번째 이미지 URL 추출
            image_url = ""
            import re
            img_match = re.search(r'<img[^>]+src=["\']([^"\'>]+)["\']', downloaded)
            if img_match:
                candidate = img_match.group(1)
                # 홈페이지 로고 등 작은 에셋 이미지 제외
                if candidate.startswith('http') and not any(x in candidate for x in ['logo', 'icon', 'avatar', 'pixel', '1x1', 'thumb']):
                    image_url = candidate
            return text, image_url
    except Exception as e:
        print(f"⚠️ 본문 추출 실패 ({url}): {e}")
    return None, ""

def fetch_reddit_comments(article_url, title, keywords):
    """Reddit 상위 반응 검색 (PRAW 대신 Keyless JSON 방식 사용 + 3단계 안전망)"""
    headers = {"User-Agent": REDDIT_USER_AGENT}
    
    def search_reddit(query, time_filter="month"):
        url = f"https://www.reddit.com/search.json?q={requests.utils.quote(query)}&sort=top&t={time_filter}&limit=3"
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                children = data.get('data', {}).get('children', [])
                return [child['data'] for child in children]
            else:
                print(f"   ⚠️ Reddit Search API Error: {resp.status_code}")
        except Exception as e:
            print(f"   ⚠️ Reddit Search Exception: {e}")
        return []

    def get_comments(post_id):
        url = f"https://www.reddit.com/comments/{post_id}.json?sort=confidence&limit=5"
        comments = []
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if len(data) > 1:
                    comment_children = data[1].get('data', {}).get('children', [])
                    for child in comment_children:
                        if child['kind'] == 't1':  # t1 은 댓글을 의미
                            body = child['data'].get('body', '')
                            if len(body) > 10 and "[deleted]" not in body:
                                comments.append(body.replace('\n', ' '))
        except Exception as e:
            pass
        return comments

    try:
        submissions = []
        # 1단계: URL 기반 아주 정확한 검색
        search_query = f'url:"{article_url}"'
        submissions = search_reddit(search_query, time_filter="month")
        time.sleep(1) # Rate limit 방지
        
        # 2단계: URL 검색 실패 시, 제목 기반 추정 검색
        if not submissions:
            import re
            clean_title = re.sub(r'[^\w\s]', '', title).strip()
            short_title = " ".join(clean_title.split()[:5])
            
            search_query = f'"{short_title}"'
            submissions = search_reddit(search_query, time_filter="week")
            time.sleep(1)
            
            # 3단계: LLM 교차 검증
            if submissions:
                candidate = submissions[0]
                validation_prompt = f"""
                뉴스 기사 원본 제목: "{title}"
                레딧 게시물 제목: "{candidate.get('title', '')}"
                두 제목이 정확하게 동일한 뉴스 내용에 대해 반응하고 있습니까?
                유사한 과거 사건이 아니라, 정확히 같은 사건인가요?
                오직 "True" 또는 "False" 로만 답변하세요.
                """
                try:
                    val_res = model.generate_content(validation_prompt).text.strip().lower()
                    if "true" not in val_res:
                        print(f"   ⚠️ Reddit 토픽 불일치로 배제: {candidate.get('title', '')[:30]}")
                        return ""
                except Exception as eval_e:
                    print(f"   ⚠️ Reddit 검증 단계 무시 (에러): {eval_e}")
                    return ""
                
        # 최종 수집 로직
        if submissions:
            best_post = submissions[0]
            post_id = best_post.get('id')
            subreddit_name = best_post.get('subreddit')
            
            top_comments = get_comments(post_id)
            time.sleep(1)
                    
            if top_comments:
                print(f"   💬 Reddit 반응 확보 (r/{subreddit_name}): 댓글 {len(top_comments)}개")
                return "\n".join([f"- {c}" for c in top_comments])
                
    except Exception as e:
        print(f"   ⚠️ Reddit 파싱 실패: {e}")
        
    return ""

def fetch_wikipedia_image(keywords):
    """AI 추출 키워드를 Wikipedia API로 검색하여 이미지 URL 반환 (CC 라이선스)"""
    for keyword in keywords[:4]:  # 최대 4개 키워드 순서대로 시도
        try:
            url = (
                "https://en.wikipedia.org/w/api.php"
                f"?action=query&titles={requests.utils.quote(str(keyword))}"
                "&prop=pageimages&format=json&pithumbsize=800"
            )
            resp = requests.get(url, timeout=5,
                                headers={"User-Agent": "CollectiveMonologue/1.0"})
            data = resp.json()
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                thumb = page.get("thumbnail", {}).get("source", "")
                if thumb:
                    print(f"   🖼️ Wikipedia 이미지 확보: [{keyword}]")
                    return thumb
        except Exception as e:
            print(f"   ⚠️ Wikipedia 검색 실패 ({keyword}): {e}")
    return ""

def translate_and_summarize(text, title, reddit_comments=""):
    if not GEMINI_API_KEY:
        return {"title_en": title, "summary_en": "No API Key provided.", "keywords": []}

    if not text or len(text) < 50:
        return {"title_en": title, "summary_en": "Content too short or extraction failed.", "keywords": []}
    
    # 너무 긴 텍스트는 잘라서 보냄 (토큰 제한 방지)
    truncated_text = text[:4000]

    reddit_section = ""
    if reddit_comments:
        reddit_section = f"""
    Additional Context (Reddit Comments - Local Fan Reactions):
    {reddit_comments}
    
    IMPORTANT: You have local fan reactions from Reddit. Synthesize these authentic reactions into your editorial. Describe what the US fans are excited about, worried about, or debating regarding this news. This is crucial for adding cultural depth.
        """

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
    {reddit_section}

    Write as a knowledgeable Korean cultural journalist — warm, insightful, and informative.
    The output must be a JSON object with KOREAN text for title_kr, summary_kr, and content_kr:
    {{
        "title_kr": "한국 독자의 흥미를 끌 수 있는 매력적인 기사 제목 (한국어)",
        "summary_kr": "메인 페이지 리스트에 표시될 1-2문장의 핵심 요약. 독자가 클릭하고 싶게 만들어라 (한국어)",
        "content_kr": "기사 본문. 뉴스 요약 + 등장 인물/작품/공연장에 대한 배경 지식을 자연스럽게 녹인 풍부한 텍스트. 문단을 나누어 가독성 좋게 작성. (만약 Reddit 댓글 섹션이 주어졌다면 본문 내에 '해외 매니아 반응' 트렌드를 분석해서 반영할 것) 마지막엔 '편집자 주' 한 문단을 추가할 것 (한국어)",
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
        "title_en": title,
        "summary_en": "Summarization failed.",
        "title_kr": title,
        "summary_kr": "정보를 불러오는 중 오류가 발생했습니다.",
        "content_kr": "본문을 처리하지 못했습니다.",
        "keywords": []
    }

def fetch_broadway_grosses():
    """Playbill.com에서 이번 주 브로드웨이 박스오피스 데이터를 가져옵니다."""
    url = "https://www.playbill.com/grosses"
    headers = {"User-Agent": REDDIT_USER_AGENT}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            soup = bs4.BeautifulSoup(resp.content, 'html.parser')
            table = soup.find('table')
            if not table:
                return []
            
            rows = table.find('tbody').find_all('tr') if table.find('tbody') else table.find_all('tr')[1:]
            grosses = []
            for row in rows:
                cols = row.find_all('td')
                if len(cols) >= 8:
                    # 제목 태그 안의 텍스트만 추출 (극장명 분리 위함)
                    show_node = cols[0].find('a')
                    show_name = show_node.get_text(strip=True) if show_node else cols[0].get_text(strip=True).split('Theatre')[0]
                    
                    gross_str = cols[1].get_text(strip=True)
                    capacity_str = cols[6].get_text(strip=True)
                    
                    try:
                        parsed_gross = float(gross_str.replace('$', '').replace(',', ''))
                        grosses.append({
                            "show": show_name,
                            "gross_formatted": gross_str,
                            "gross": parsed_gross,
                            "capacity": capacity_str
                        })
                    except ValueError:
                        continue
                        
            # 매출액(Gross) 기준 내림차순 정렬 후 상위 5개 추출
            grosses.sort(key=lambda x: x['gross'], reverse=True)
            for i, item in enumerate(grosses[:5]):
                item['rank'] = i + 1
            return grosses[:5]
    except Exception as e:
        print(f"   ⚠️ 브로드웨이 박스오피스 파싱 실패: {e}")
    return []

def generate_weekly_recommendations(articles_data):
    """최근 인디 매체 중심 기사 데이터를 바탕으로 오프-브로드웨이/시카고 추천작 3개를 뽑습니다."""
    if not GEMINI_API_KEY or not articles_data:
        return []

    context = ""
    for idx, article in enumerate(articles_data[:10]):
        context += f"[{idx+1}] 제목: {article['title_kr']}\n요약: {article['summary_kr']}\n\n"
        
    prompt = f"""
    당신은 미국 연극 전문가입니다. 아래는 이번 주 수집된 연극 기사들의 목록입니다.
    이를 바탕으로 **오프-브로드웨이 또는 시카고 등 지역 연극/화제작 중 추천할 만한 작품 3개**를 선정해 짧게 추천 이유를 작성해주세요.

    기사 목록:
    {context}

    반드시 JSON 배열 형태로 응답하세요. 각 객체는 "title" (작품명, 한글/영문 병기), "reason" (추천 이유, 2문장 이내) 키를 가져야 합니다.
    기사 내용 중 추천할 만한 구체적인 연극 작품이 부족하다면, 현재 미국에서 평단의 높은 지지를 받고 있는 오프-브로드웨이 화제작을 임의로 골라도 좋습니다.
    
    [
        {{"title": "민중의 적 (An Enemy of the People)", "reason": "제레미 스트롱의 명연기와 함께 환경 문제라는 시대적 화두를 던지는 필람 연극입니다."}}
    ]
    답변은 오직 JSON 형식으로만 해주세요.
    """
    try:
        response = model.generate_content(prompt).text.strip()
        if response.startswith("```json"):
            response = response[7:]
        if response.endswith("```"):
            response = response[:-3]
        return json.loads(response.strip())
    except Exception as e:
        print(f"   ⚠️ 주간 추천작 생성 실패: {e}")
    return []

def process_entry(entry, source, tier):
    """Process individual article (for parallel execution)"""
    title = entry.title
    link = entry.link
    published = entry.get('published', datetime.now().strftime("%Y-%m-%d"))
    
    print(f"   Analyzing [{tier.upper()}]: {title[:30]}...")

    # 1. Extract full text + image from article HTML
    full_text, html_image = fetch_article_content(link)
    
    # 2. Extract local reactions from Reddit (URL & Title based)
    reddit_comments = fetch_reddit_comments(link, title, [])
    
    # 3. AI Summary with Reddit context
    ai_result = translate_and_summarize(full_text, title, reddit_comments)

    # Extract image: RSS metadata 우선, 없으면 HTML 파싱, 그래도 없으면 Wikipedia 검색
    image_url = html_image  # 기본값: HTML에서 추출한 이미지
    if 'media_content' in entry and len(entry.media_content) > 0:
        image_url = entry.media_content[0].get('url', '') or html_image
    elif 'media_thumbnail' in entry and len(entry.media_thumbnail) > 0:
        image_url = entry.media_thumbnail[0].get('url', '') or html_image
    elif 'links' in entry:
        for link_item in entry.links:
            if link_item.get('type', '').startswith('image/'):
                image_url = link_item.get('href', '') or html_image
                break

    # RSS나 HTML에서 이미지를 못 찾았으면 Wikipedia 이미지 검색
    if not image_url and ai_result.get('keywords'):
        # AI가 추출한 영문 키워드로 직접 검색 (원문 제목에서 로마자 찾기)
        import re
        # 영문 단어가 포함된 키워드 우선 (ex. 배우 이름 등)
        original_title_words = entry.title
        en_keywords = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+', original_title_words)
        search_keywords = en_keywords + ai_result.get('keywords', [])
        image_url = fetch_wikipedia_image(search_keywords)

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
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") # Changed to timezone.utc
    }

def send_email(articles):
    if not EMAIL_SENDER or not EMAIL_PASSWORD or not articles:
        return

    subject = f"[StageSide] Latest News Briefing - {datetime.now().strftime('%Y-%m-%d %H:%M')}" # Kept datetime.now() as per instruction for subject
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

    os.makedirs("data", exist_ok=True)
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
                # 각 소스별 최신 2개씩 수집 (버퍼 확보: 1개 실패 시 다음 것으로 대체)
                for entry in feed.entries[:2]:
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
