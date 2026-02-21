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
    "The Hollywood Reporter": "https://www.hollywoodreporter.com/feed/",
    "IndieWire": "https://www.indiewire.com/feed/",
    "Variety Theater": "https://variety.com/v/legit/feed/",
}

# 인디 소스 (대학로 감성, 비영리, 소규모 극장)
INDIE_FEEDS = {
    "American Theatre": "https://www.americantheatre.org/feed/",
    "HowlRound": "https://howlround.com/rss.xml",  # 온라인 비영리 연극 매거진 HowlRound
    "TheaterMania": "https://www.theatermania.com/feed/",
    "Backstage": "https://www.backstage.com/magazine/article/feed/",
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
    """Reddit 서브레딧 Hot 게시물 기반으로 관련 반응 수집 (키워드 매칭 방식)"""
    headers = {"User-Agent": REDDIT_USER_AGENT}

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
                        if child['kind'] == 't1':
                            body = child['data'].get('body', '')
                            if len(body) > 10 and "[deleted]" not in body:
                                comments.append(body.replace('\n', ' '))
        except Exception:
            pass
        return comments

    def fetch_subreddit_hot(subreddit, limit=15):
        """서브레딧의 최신(Hot) 게시물 목록을 가져옵니다."""
        url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit={limit}"
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                children = resp.json().get('data', {}).get('children', [])
                return [c['data'] for c in children]
        except Exception:
            pass
        return []

    import re
    try:
        # 기사 제목의 핵심 단어 추출 (짧은 단어 및 불용어 제거)
        stopwords = {'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'will', 'with', 'that', 'this', 'from', 'by', 'as', 'it', 'new', 'its', 'into', 'has', 'have', 'set'}
        title_words = set(w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', title) if w.lower() not in stopwords)

        subreddits_to_try = ['Broadway', 'theater', 'movies', 'boxoffice']
        best_post = None
        best_score = 0

        for subreddit in subreddits_to_try:
            posts = fetch_subreddit_hot(subreddit, limit=15)
            time.sleep(0.5)
            for post in posts:
                post_title = post.get('title', '')
                post_words = set(w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', post_title))
                overlap = len(title_words & post_words)
                if overlap > best_score:
                    best_score = overlap
                    best_post = post
                    best_post['_subreddit'] = subreddit

        # 공통 키워드 1개 이상이면 관련 게시물로 인정 (엄격 기준보다 수집률 우선)
        if best_post and best_score >= 1:
            post_id = best_post.get('id')
            subreddit_name = best_post.get('_subreddit', best_post.get('subreddit', ''))
            top_comments = get_comments(post_id)
            time.sleep(0.5)
            if top_comments:
                print(f"   💬 Reddit 반응 확보 (r/{subreddit_name}, overlap={best_score}): 댓글 {len(top_comments)}개")
                return "\n".join([f"- {c}" for c in top_comments])
            else:
                print(f"   ⚠️ Reddit 게시물 발견했지만 댓글 없음")
        else:
            print(f"   ℹ️ Reddit 관련 게시물 없음 (best overlap={best_score})")

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
        "content_kr": "기사 본문. 뉴스 요약 + 등장 인물/작품/공연장에 대한 배경 지식을 자연스럽게 녹인 풍부한 텍스트. 문단을 나누어 가독성 좋게 작성. 마지막엔 '편집자 주' 한 문단을 추가할 것 (한국어)",
        "reddit_reaction_kr": "만약 Reddit 댓글이 주어졌다면, 현지 팬들의 생생한 반응을 뉴스 포맷에 맞게 1문단으로 재미있게 요약 (한국어). 없다면 빈 문자열",
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
                    # 공연명과 극장명 분리
                    full_text = cols[0].get_text(strip=True)
                    show_node = cols[0].find('a')
                    show_name = show_node.get_text(strip=True) if show_node else full_text
                    # 극장명: 전체 텍스트에서 공연명을 빼면 극장명만 남음
                    theater_name = full_text.replace(show_name, '').strip()
                    
                    gross_str = cols[1].get_text(strip=True)
                    diff_str = cols[2].get_text(strip=True)  # 전주 대비 변동
                    avg_ticket_str = cols[3].get_text(strip=True)  # 평균 티켓 가격
                    attendance_str = cols[4].get_text(strip=True)  # 관객 수
                    capacity_str = cols[6].get_text(strip=True)
                    
                    try:
                        parsed_gross = float(gross_str.replace('$', '').replace(',', ''))
                        grosses.append({
                            "show": show_name,
                            "theater": theater_name,
                            "gross_formatted": gross_str,
                            "gross": parsed_gross,
                            "diff": diff_str,
                            "avg_ticket": avg_ticket_str,
                            "attendance": attendance_str,
                            "capacity": capacity_str
                        })
                    except ValueError:
                        continue
                        
            # 매출액(Gross) 기준 내림차순 정렬 후 상위 5개 추출
            grosses.sort(key=lambda x: x['gross'], reverse=True)
            top5 = grosses[:5]
            for i, item in enumerate(top5):
                item['rank'] = i + 1
            
            # LLM으로 각 공연에 대한 한 줄 한국어 소개 추가
            if GEMINI_API_KEY and top5:
                try:
                    show_list = ", ".join([s['show'] for s in top5])
                    desc_prompt = f"""아래 5개 브로드웨이 공연에 대해 각각 한국어로 한 줄(15~25자) 소개를 작성해주세요.
뮤지컬이면 장르와 분위기를, 연극이면 주제나 배우를 간단히 언급해주세요.
반드시 JSON 객체 형태로만 응답하세요. 키는 공연명(영문), 값은 한국어 소개입니다.

공연 목록: {show_list}

예시: {{"Hamilton": "미국 건국의 역사를 힙합으로 풀어낸 뮤지컬"}}
"""
                    desc_resp = model.generate_content(desc_prompt).text.strip()
                    if desc_resp.startswith("```json"):
                        desc_resp = desc_resp[7:]
                    if desc_resp.endswith("```"):
                        desc_resp = desc_resp[:-3]
                    descriptions = json.loads(desc_resp.strip())
                    for item in top5:
                        item['description_kr'] = descriptions.get(item['show'], '')
                except Exception as e:
                    print(f"   ⚠️ 공연 소개 생성 스킵: {e}")
            
            return top5
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
        "reddit_reaction_kr": ai_result.get('reddit_reaction_kr', ''),
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
    
    # 볼륨 확대: 메이저 5개 + 인디 4개 유지 (총 9개)
    final_data = major_articles[:5] + indie_articles[:4]

    os.makedirs("data", exist_ok=True)
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)
    print(f"✅ 저장 완료: 메이저 {len(major_articles[:5])}건 + 인디 {len(indie_articles[:4])}건 = 총 {len(final_data)}건")
    
    # Sitemap 생성 로직 추가
    generate_sitemap(final_data)

def generate_sitemap(articles):
    """
    저장된 기사 데이터를 바탕으로 구글 검색용 sitemap.xml을 생성합니다.
    """
    import urllib.parse
    base_url = "https://limjinou.github.io/collectivemonologue"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml_content += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    
    # 기본 정적 페이지들
    static_pages = ['index.html', 'category.html', 'about.html', 'contact.html', 'privacy.html']
    for page in static_pages:
        xml_content += '  <url>\n'
        xml_content += f'    <loc>{base_url}/{page}</loc>\n'
        xml_content += f'    <lastmod>{today}</lastmod>\n'
        xml_content += '    <changefreq>daily</changefreq>\n'
        xml_content += '    <priority>0.8</priority>\n'
        xml_content += '  </url>\n'

    # 동적 기사 페이지들 (article.html?id=...)
    for article in articles:
        # 영문 타이틀을 소문자로 바꾸고 공백을 언더스코어로 파싱하여 ID 생성 (frontend main.js와 동일 로직 예상)
        safe_title = "".join(c if c.isalnum() or c.isspace() else "" for c in article['original_title']).strip()
        article_id = safe_title.replace(' ', '_').lower()
        encoded_id = urllib.parse.quote(article_id)
        
        xml_content += '  <url>\n'
        xml_content += f'    <loc>{base_url}/article.html?id={encoded_id}</loc>\n'
        xml_content += f'    <lastmod>{today}</lastmod>\n'
        xml_content += '    <changefreq>weekly</changefreq>\n'
        xml_content += '    <priority>0.6</priority>\n'
        xml_content += '  </url>\n'

    xml_content += '</urlset>'

    with open('sitemap.xml', 'w', encoding='utf-8') as f:
        f.write(xml_content)
    print("✅ sitemap.xml 자동 생성 완료")

def crawl_rss():
    print("🚀 크롤러(ver.2) 시작 — 메이저 5건 + 인디 4건 수집")
    
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
