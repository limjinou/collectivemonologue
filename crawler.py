import feedparser
import smtplib
from email.mime.text import MIMEText
import os
import sys
from google import genai
from datetime import datetime, timezone
from dotenv import load_dotenv
import json
import trafilatura
import concurrent.futures
import time
import requests
import bs4

FAILED_QUEUE_PATH = 'data/failed_queue.json'
COST_LOG_PATH = 'data/cost_log.json'
RUN_LOG_DIR = 'data/run_logs'
MAX_RETRY = 3

RUN_STATS = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "finished_at": "",
    "feeds_checked": 0,
    "entries_found": 0,
    "entries_selected": 0,
    "processed": 0,
    "added": 0,
    "skipped_duplicate": 0,
    "failed": 0,
    "failures_by_reason": {}
}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

def today_key():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def load_json_file(path, default):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"⚠️ JSON load failed ({path}): {e}")
    return default

def write_json_file(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def increment_failure_stat(reason):
    RUN_STATS["failed"] += 1
    failures = RUN_STATS["failures_by_reason"]
    failures[reason] = failures.get(reason, 0) + 1

def is_quota_error(error):
    message = str(error).lower()
    return "429" in message or "quota" in message or "resource_exhausted" in message

def log_api_call(model, success, quota_error=False, estimated_input_chars=0):
    log = load_json_file(COST_LOG_PATH, {})
    key = today_key()
    day = log.setdefault(key, {
        "total_calls": 0,
        "success": 0,
        "failed": 0,
        "quota_errors": 0,
        "models_used": {},
        "estimated_input_chars": 0
    })
    day["total_calls"] += 1
    day["success" if success else "failed"] += 1
    if quota_error:
        day["quota_errors"] += 1
    day["models_used"][model] = day["models_used"].get(model, 0) + 1
    day["estimated_input_chars"] = day.get("estimated_input_chars", 0) + int(estimated_input_chars or 0)
    write_json_file(COST_LOG_PATH, log)

def record_failure(entry, reason, source="", tier="", last_error=""):
    if hasattr(entry, "get"):
        title = getattr(entry, "title", "") or entry.get("title", "")
        link = getattr(entry, "link", "") or entry.get("link", "")
        published = entry.get('published', datetime.now().strftime("%Y-%m-%d"))
    else:
        title = getattr(entry, "title", "")
        link = getattr(entry, "link", "")
        published = datetime.now().strftime("%Y-%m-%d")
    queue = load_json_file(FAILED_QUEUE_PATH, [])
    existing = next((item for item in queue if item.get("link") == link and link), None)
    payload = {
        "failed_at": now_iso(),
        "reason": reason,
        "source": source,
        "tier": tier,
        "title": title,
        "link": link,
        "published": published,
        "last_error": str(last_error)[:1000],
        "attempt_count": 1,
        "max_retry": MAX_RETRY
    }
    if existing:
        existing.update(payload)
        existing["attempt_count"] = int(existing.get("attempt_count", 0)) + 1
    else:
        queue.append(payload)
    write_json_file(FAILED_QUEUE_PATH, queue)
    increment_failure_stat(reason)

def write_run_log():
    RUN_STATS["finished_at"] = now_iso()
    os.makedirs(RUN_LOG_DIR, exist_ok=True)
    write_json_file(os.path.join(RUN_LOG_DIR, f"{today_key()}.json"), RUN_STATS)

# 1. 환경 변수 로드
load_dotenv()

# API 키 및 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if not GEMINI_API_KEY:
    print("❌ CRITICAL: GEMINI_API_KEY is missing in environment!")

EMAIL_SENDER = os.getenv("EMAIL_SENDER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
EMAIL_RECEIVER = os.getenv("EMAIL_RECEIVER")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "Stage-Is_Crawler/1.0")

# Gemini 설정 (최신 SDK 사용)
client = None
if GEMINI_API_KEY:
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        print("✅ Gemini Client initialized.")
    except Exception as e:
        print(f"❌ Gemini Client initialization failed: {e}")

# 모델 이원화 전략: 가용 리스트상 가장 가벼운 엔진으로 고정 (쿼터 에러 원천 차단)
PRO_MODEL_ID = 'gemini-flash-latest'
FLASH_MODEL_ID = 'gemini-flash-latest'

# 메이저 소스 (브로드웨이 / 할리우드 메이저)
MAJOR_FEEDS = {
    "IndieWire": "https://www.indiewire.com/feed/",
    "Deadline Theater": "https://deadline.com/v/theater/feed/",
    "Broadway.com": "https://www.broadway.com/feeds/buzz/latest/",
    "The Hollywood Reporter": "https://www.hollywoodreporter.com/feed/",
    "Variety Theater": "https://variety.com/v/legit/feed/",
    "BroadwayWorld": "https://www.broadwayworld.com/rss/newsroom", # URL 업데이트
}

# 인디 소스 (대학로 감성, 비영리, 소규모 극장)
INDIE_FEEDS = {
    "American Theatre": "https://www.americantheatre.org/feed/",
    "HowlRound": "https://howlround.com/rss.xml",
    "TheaterMania": "https://www.theatermania.com/feed/",
    # Backstage는 현재 RSS 미비로 제외
}

def fetch_article_content(url):
    """Trafilatura를 사용하여 기사 본문 및 고해상도 이미지 URL 추출 (og:image 우선)"""
    try:
        image_url = ""
        try:
            resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if resp.status_code == 200:
                soup = bs4.BeautifulSoup(resp.content, 'html.parser')
                og_img = soup.find('meta', property='og:image')
                if og_img and og_img.get('content'):
                    image_url = og_img['content']
                elif soup.find('meta', attrs={'name': 'twitter:image'}):
                    image_url = soup.find('meta', attrs={'name': 'twitter:image'})['content']
        except Exception:
            pass

        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded)
            # og:image를 못 찾았을 경우 본문에서 첫 번째 img 태그 추출 시도
            if not image_url:
                import re
                img_match = re.search(r'<img[^>]+src=["\']([^"\'>]+)["\']', downloaded)
                if img_match:
                    candidate = img_match.group(1)
                    # 명백한 더미 이미지, 빈 픽셀, 추적 픽셀 등 철저히 제외
                    if candidate.startswith('http') and not any(x in candidate.lower() for x in ['logo', 'icon', 'avatar', 'pixel', '1x1', 'blank', 'scorecardresearch']):
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
                                headers={"User-Agent": "Stage-Is/1.0"})
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
    
    # TPM 초과 방지를 위해 텍스트 처리량을 2000자로 대폭 제한 (확정적 생성 보장)
    truncated_text = text[:2000]

    reddit_section = ""
    if reddit_comments:
        reddit_section = f"""
    Additional Context (Community Comments - Local Fan Reactions):
    {reddit_comments}
    
    IMPORTANT: Synthesize these authentic reactions into your editorial. 
    Analyze the subtext of their excitement, worry, or debate. 
    Do NOT mention 'Reddit'. Refer to them as '현지 커뮤니티' or '현지 반응'.
        """

    prompt = f"""
    You are the Senior Chief Editor of "Stage-Is", a world-class premium magazine specializing in American theater arts. 
    Your expertise is comparable to the most respected theater critics and dramaturgs in South Korea.

    Below is an article titled '{title}'. Your mission is to craft a profound, intellectually stimulating Korean editorial focusing on performing arts.
    Leverage your advanced reasoning capabilities to provide deep theatrical and cultural insights.

    STRICT REQUIREMENTS:
    1. **Masterful Storytelling**: Use sophisticated yet accessible Korean. Your tone should be warm, authoritative, and deeply insightful, like a veteran cultural critic for a premium print magazine.
    2. **Dynamic Structure (Avoid Generic Headers)**: Do NOT use generic headers like '기사 핵심 요약'. Instead, create **Creative Subheadings** (`<h3>`) that capture the poetic or intellectual essence of each section.
    3. **Visual & Narrative Depth**:
       - Use `<blockquote>` to highlight powerful quotes from the article or to present your most striking editorial insights.
       - Ensure paragraphs (`<p>`) are well-separated and offer a progressive narrative flow.
       - At least 3-4 distinct sections including a deep 'Editor's Perspective' and a 'Local Fan/Critic Dialectic'.
    4. **Enlightening Keyword Dictionary (용어 한 스푼)**: Choose 1-2 specialized terms. Rewrite the definition in a way that feels like a friendly master artist explaining a secret of the trade. 

    JSON Structure:
    {{
        "title_kr": "기사의 본질과 에디터의 미학이 담긴 매력적인 제목",
        "summary_kr": "독자의 지적 호기심을 자극하는 1-2문장의 고품격 요약",
        "why_it_matters_kr": "이 기사를 지금 읽어야 하는 이유를 한국 독자에게 1문장으로 설명",
        "editorial_category": "criticism | industry | voices | queer_lens | stage_to_screen | cultural_signal 중 하나",
        "editorial_category_label": "Criticism | Industry | Voices | Queer Lens | Stage to Screen | Cultural Signal 중 하나",
        "context_kr": "인물, 극장, 작품, 산업 배경 중 한국 독자가 이해하면 좋은 맥락 1-2문장",
        "korean_reader_note_kr": "한국 독자가 이 기사를 자기 문화권의 공연/영화 감각과 연결해 읽을 수 있는 짧은 노트",
        "signal_keywords": ["이번 기사에서 읽히는 문화적 징후1", "징후2", "징후3"],
        "content_kr": "HTML tags 활용: 기사 인트로 -> <h3>[동적 소제목]</h3><p>...심층 분석...</p> -> <blockquote>...핵심 통찰 또는 인용...</blockquote> -> <h3>[동적 소제목]</h3><p>...현지 반응 분석...</p> -> <h3>[용어 한 스푼]</h3><p>...아름다운 용어 설명...</p>",
        "keywords": ["키워드1", "키워드2", "키워드3"]
    }}

    Article Body:
    {truncated_text}
    
    {reddit_section}
    """

    # 재시도 로직 (초기 쿼터 제한 대응을 위해 대폭 강화)
    max_retries = 3
    base_delay = 30

    for attempt in range(max_retries):
        try:
            print(f"   🤖 [{attempt+1}/{max_retries}] {PRO_MODEL_ID} 분석 시도 중...")
            response = client.models.generate_content(
                model=PRO_MODEL_ID,
                contents=prompt,
                config={"response_mime_type": "application/json"}
            )
            print("   ✨ 고지능 분석 완료.")
            return json.loads(response.text)
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                wait_time = base_delay * (2 ** attempt) + (attempt * 2)
                print(f"   ⚠️ Pro 쿼터 초과. {wait_time}초 대기 후 재시도...")
                time.sleep(wait_time)
            else:
                print(f"   ⚠️ Pro 분석 중 에러: {e}")
                break
    
    # [Fallback] Pro 모델 실패 시 Flash 모델로 긴급 전환
    print(f"   🔄 Pro 모델 실패. {FLASH_MODEL_ID}로 긴급 전환하여 분석합니다...")
    try:
        response = client.models.generate_content(
            model=FLASH_MODEL_ID,
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )
        print("   ✅ Flash 모델로 분석 대체 완료.")
        return json.loads(response.text)
    except Exception as e:
        print(f"   ❌ 긴급 Flash 분석도 실패: {e}")
        return {
            "title_kr": title,
            "summary_kr": "AI 모델 일시적 과부하로 정보를 불러오지 못했습니다.",
            "content_kr": "본문 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            "keywords": []
        }

_legacy_translate_and_summarize = translate_and_summarize

def translate_and_summarize(text, title, reddit_comments=""):
    """Wrap the existing translator with API usage logging and failure signals."""
    if not GEMINI_API_KEY:
        return {
            "_error_reason": "missing_api_key",
            "_error_message": "GEMINI_API_KEY is missing.",
            "title_en": title,
            "summary_en": "No API Key provided.",
            "keywords": []
        }

    if not text or len(text) < 50:
        return {
            "_error_reason": "content_too_short",
            "_error_message": "Content too short or extraction failed.",
            "title_en": title,
            "summary_en": "Content too short or extraction failed.",
            "keywords": []
        }

    if not client:
        return {
            "_error_reason": "model_error",
            "_error_message": "Gemini client is not initialized.",
            "title_kr": title,
            "summary_kr": "AI 모델 처리 중 오류가 발생했습니다.",
            "content_kr": "본문 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            "keywords": []
        }

    original_generate_content = client.models.generate_content
    call_state = {"last_reason": "", "last_error": ""}

    def generate_content_with_logging(*args, **kwargs):
        model = kwargs.get("model") or (args[0] if args else "unknown")
        contents = kwargs.get("contents", "")
        estimated_chars = len(str(contents))
        try:
            response = original_generate_content(*args, **kwargs)
            log_api_call(model, True, estimated_input_chars=estimated_chars)
            return response
        except Exception as e:
            quota_error = is_quota_error(e)
            log_api_call(model, False, quota_error=quota_error, estimated_input_chars=estimated_chars)
            call_state["last_reason"] = "quota_exceeded" if quota_error else "model_error"
            call_state["last_error"] = str(e)
            raise

    client.models.generate_content = generate_content_with_logging
    try:
        result = _legacy_translate_and_summarize(text, title, reddit_comments)
    except json.JSONDecodeError as e:
        return {
            "_error_reason": "json_parse_error",
            "_error_message": str(e),
            "title_kr": title,
            "summary_kr": "AI 응답 파싱 중 오류가 발생했습니다.",
            "content_kr": "본문 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            "keywords": []
        }
    finally:
        client.models.generate_content = original_generate_content

    if isinstance(result, dict) and call_state["last_reason"]:
        summary = str(result.get("summary_kr", ""))
        content = str(result.get("content_kr", ""))
        looks_like_error = (
            "오류" in summary
            or "오류" in content
            or "과부하" in summary
            or "error" in summary.lower()
            or "failed" in summary.lower()
        )
    else:
        looks_like_error = False

    if looks_like_error:
        result["_error_reason"] = call_state["last_reason"]
        result["_error_message"] = call_state["last_error"]
    return result

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
                    # 가벼운 작업은 고속 모델(Flash) 사용하여 쿼터 절약
                    desc_resp = client.models.generate_content(model=FLASH_MODEL_ID, contents=desc_prompt).text.strip()
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
        # 가벼운 작업은 고속 모델(Flash) 사용하여 쿼터 절약
        response = client.models.generate_content(model=FLASH_MODEL_ID, contents=prompt).text.strip()
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
    if ai_result.get("_error_reason"):
        record_failure(
            entry,
            ai_result.get("_error_reason", "model_error"),
            source,
            tier,
            ai_result.get("_error_message", "")
        )
        return None

    # Extract image: RSS metadata 우선, 없으면 HTML 파싱 (og:image)
    image_url = ""
    if 'media_content' in entry and len(entry.media_content) > 0:
        image_url = entry.media_content[0].get('url', '')
    elif 'media_thumbnail' in entry and len(entry.media_thumbnail) > 0:
        image_url = entry.media_thumbnail[0].get('url', '')
    elif 'enclosures' in entry and len(entry.enclosures) > 0:
        for enc in entry.enclosures:
            if enc.get('type', '').startswith('image/'):
                image_url = enc.get('href', '')
                break

    if not image_url:
        image_url = html_image
        
    # 최종 정크 이미지 방어선 (추적 픽셀 필터링)
    if image_url and any(x in image_url.lower() for x in ['scorecardresearch', 'pixel', '1x1', 'avatar', 'icon', 'blank']):
        image_url = ""

    # RSS나 HTML에서 이미지를 못 찾았으면 Wikipedia 이미지 검색 (항상 시도)
    if not image_url:
        import re
        original_title_words = entry.title
        en_keywords = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+', original_title_words)
        search_keywords = en_keywords + [str(k) for k in ai_result.get('keywords', [])]
        if search_keywords:
            image_url = fetch_wikipedia_image(search_keywords)

    # Validate the data before returning
    summary_kr = ai_result.get('summary_kr', '내용 없음').strip()
    if not summary_kr or "내용 없음" in summary_kr or len(summary_kr) < 20:
        print(f"   ⚠️ 유효하지 않은 기사 내용 제외: {title[:30]}")
        record_failure(entry, "invalid_summary", source, tier, "Summary is missing, placeholder, or too short.")
        return None
        
    # 엄격한 이미지 보장: Wikipedia 폴백까지 실패하면 기사를 버립니다 (선택적)
    # 현재 정책: 이미지가 없더라도 본문이 훌륭하면 살립니다. 하지만 사용자 요청에 따라
    # 이미지가 없으면 버리는 엄격한 정책을 적용할 수 있습니다. 
    # 일단은 이미지가 없을 경우 플레이스홀더를 사용하도록 냅두되, 빈 내용을 막는 데 집중합니다.
    # 사용자가 "사진도 있지 않음"이라고 했으므로 사진이 None이면 버리도록 수정합니다.
    if not image_url:
         print(f"   ⚠️ 이미지 확보 실패 기사 제외: {title[:30]}")
         record_failure(entry, "missing_image", source, tier, "No usable image found from RSS, HTML, or Wikipedia.")
         return None

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
        "why_it_matters_kr": ai_result.get('why_it_matters_kr', ''),
        "editorial_category": ai_result.get('editorial_category', ''),
        "editorial_category_label": ai_result.get('editorial_category_label', ''),
        "context_kr": ai_result.get('context_kr', ''),
        "korean_reader_note_kr": ai_result.get('korean_reader_note_kr', ''),
        "signal_keywords": ai_result.get('signal_keywords', []),
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

def slugify(text):
    """제목을 파일명 및 ID로 사용 가능한 형태로 변환"""
    text = "".join(c if c.isalnum() or c.isspace() else "" for c in text).strip()
    return text.replace(" ", "-").lower()

def normalize_editorial_fields(article):
    """Ensure each article has Stage-Is editorial framing fields without extra API calls."""
    title = f"{article.get('original_title', '')} {article.get('title_kr', '')}".lower()
    keywords = [str(k).lower() for k in article.get('keywords', [])]
    text = " ".join([title] + keywords)

    if not article.get('editorial_category'):
        if any(word in text for word in ['queer', 'gay', 'trans', 'lgbt', '퀴어']):
            category, label = 'queer_lens', 'Queer Lens'
        elif any(word in text for word in ['interview', 'stars', 'director', 'actor', 'contributors', 'voices']):
            category, label = 'voices', 'Voices'
        elif any(word in text for word in ['leadership', 'director', 'foundation', 'theatre', 'theater', 'industry', 'box office']):
            category, label = 'industry', 'Industry'
        elif any(word in text for word in ['adaptation', 'screen', 'film', 'movie', 'tv', 'stage']):
            category, label = 'stage_to_screen', 'Stage to Screen'
        elif any(word in text for word in ['review', 'criticism', '비평', '리뷰']):
            category, label = 'criticism', 'Criticism'
        else:
            category, label = 'cultural_signal', 'Cultural Signal'
        article['editorial_category'] = category
        article['editorial_category_label'] = label

    article.setdefault('editorial_category_label', article.get('editorial_category', 'cultural_signal').replace('_', ' ').title())
    article.setdefault('why_it_matters_kr', article.get('summary_kr', ''))
    article.setdefault('context_kr', '')
    article.setdefault('korean_reader_note_kr', '')
    article.setdefault('signal_keywords', article.get('keywords', [])[:3])
    return article

def save_to_json(major_articles, indie_articles):
    list_path = 'data/articles_list.json'
    detail_dir = 'data/articles'
    os.makedirs(detail_dir, exist_ok=True)
    
    new_articles = major_articles + indie_articles
    if not new_articles:
        return []

    # 1. 기존 목록 로드
    existing_list = []
    if os.path.exists(list_path):
        try:
            with open(list_path, 'r', encoding='utf-8') as f:
                existing_list = json.load(f)
        except Exception as e:
            print(f"기존 목록 로드 오류: {e}")

    # 기존 링크 집합 (중복 방지)
    # articles_list.json에는 link가 없을 수도 있으므로 (있으면 좋음)
    # 만약 없으면 ID로 체크하거나, 목록 추출 시 link도 포함하도록 수정 권장
    # 현재 migrate_data.py에서는 link를 뺐으나, 중복 체크를 위해 포함하는 것이 좋음
    # 기획 수정: articles_list.json에도 link를 포함시켜 중복 체크 용이하게 함
    existing_links = {item.get('link'): item for item in existing_list if item.get('link')}
    
    actually_new = []
    for item in new_articles:
        item = normalize_editorial_fields(item)
        link = item.get('link')
        if link and link not in existing_links:
            # 고유 ID 생성
            article_id = slugify(item['original_title'])
            
            # 중복 ID 방지 (초정밀)
            if any(x.get('id') == article_id for x in existing_list):
                article_id = f"{article_id}-{int(time.time())}"
            
            item['id'] = article_id
            
            # 개별 상세 파일 저장 (Full Content)
            detail_path = os.path.join(detail_dir, f"{article_id}.json")
            with open(detail_path, 'w', encoding='utf-8') as f:
                json.dump(item, f, ensure_ascii=False, indent=4)
            
            # 목록용 요약 데이터 생성
            list_item = {
                "id": article_id,
                "title": item['original_title'],
                "title_kr": item.get('title_kr', item['original_title']),
                "summary_kr": item.get('summary_kr', ''),
                "date": item.get('date', ''),
                "image": item.get('image', ''),
                "tier": item.get('tier', 'major'),
                "source": item.get('source', ''),
                "link": link, # 중복 체크용
                "why_it_matters_kr": item.get('why_it_matters_kr', ''),
                "editorial_category": item.get('editorial_category', 'cultural_signal'),
                "editorial_category_label": item.get('editorial_category_label', 'Cultural Signal'),
                "context_kr": item.get('context_kr', ''),
                "korean_reader_note_kr": item.get('korean_reader_note_kr', ''),
                "signal_keywords": item.get('signal_keywords', item.get('keywords', [])[:3])
            }
            
            existing_list.insert(0, list_item) # 최신순
            actually_new.append(item)
        else:
            RUN_STATS["skipped_duplicate"] += 1

    RUN_STATS["added"] = len(actually_new)

    # 전체 갯수 제한 (예: 100개까지 목록 유지)
    final_list = existing_list[:100]

    with open(list_path, 'w', encoding='utf-8') as f:
        json.dump(final_list, f, ensure_ascii=False, indent=4)
        
    print(f"✅ 저장 완료: 신규 추가 {len(actually_new)}건, 목록 총 {len(final_list)}건")
    
    generate_sitemap(final_list)
    return actually_new

def generate_sitemap(articles):
    """
    저장된 기사 데이터를 바탕으로 구글 검색용 sitemap.xml을 생성합니다.
    """
    import urllib.parse
    base_url = os.getenv("SITE_BASE_URL", "https://stage-is.com").rstrip("/")
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
    seen_article_ids = set()
    for article in articles:
        article_id = article.get('id')
        if not article_id: continue
        if article_id in seen_article_ids: continue
        seen_article_ids.add(article_id)
        
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
            RUN_STATS["feeds_checked"] += 1
            print(f"📡 [{tier.upper()}] {source} 검색 중...")
            try:
                feed = feedparser.parse(url)
                selected_entries = feed.entries[:2]
                RUN_STATS["entries_found"] += len(selected_entries)
                # 각 소스별 최신 2개씩 수집 (버퍼 확보: 1개 실패 시 다음 것으로 대체)
                for entry in selected_entries:
                    entries.append((entry, source, tier))
            except Exception as e:
                print(f"⚠️ {source} 피드 오류: {e}")
                record_failure({"title": source, "link": url}, "feed_error", source, tier, e)
        return entries

    major_entries = fetch_from_feeds(MAJOR_FEEDS, 'major')
    indie_entries = fetch_from_feeds(INDIE_FEEDS, 'indie')
    major_results = []
    indie_results = []
    
    # 기사 퀄리티를 위해 전체 중 상위 2개만 처리 (메이저 우선순위 등 고려 가능하나 일단 각 1개씩 총 2개 권장)
    # 여기서는 병렬 처리 전 리스트를 슬라이싱하여 제미나이 리소스 집중
    all_entries = major_entries[:1] + indie_entries[:1] # 각각 가장 최신 1개씩 총 2개만 선별
    RUN_STATS["entries_selected"] = len(all_entries)

    # 기사 퀄리티 및 쿼터 준수를 위해 1개씩 순차 처리 (Zero-Failure)
    # 한 기사 처리가 끝날 때마다 충분한 휴식 시간을 둡니다.
    for entry, source, tier in all_entries:
        try:
            RUN_STATS["processed"] += 1
            data = process_entry(entry, source, tier)
            if data:
                if data['tier'] == 'major':
                    major_results.append(data)
                else:
                    indie_results.append(data)
            
            # 다음 기사 처리 전 글로벌 쿨다운 (초기 쿼터 보호를 위해 60초로 상향)
            print("   ⏳ 쿼터 안전 확보를 위해 60초간 기기 냉각 중...")
            time.sleep(60)
        except Exception as exc:
            print(f"❌ 기사 처리 중 에러 발생: {exc}")
            record_failure(entry, "unexpected_error", source, tier, exc)

    return major_results, indie_results

if __name__ == "__main__":
    import atexit
    atexit.register(write_run_log)
    major_data, indie_data = crawl_rss()
    if major_data or indie_data:
        new_added = save_to_json(major_data, indie_data)
        if new_added:
            send_email(new_added)
        else:
            print("새로 추가된 기사가 존재하지 않아 이메일을 발송하지 않습니다.")
    else:
        print("수집된 기사가 없습니다.")
