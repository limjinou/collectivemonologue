import os
import json
import trafilatura
import time
from dotenv import load_dotenv
from google import genai

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize the new SDK client
client = genai.Client(api_key=GEMINI_API_KEY)
model_id = 'gemini-2.5-flash'  # Use latest available flash model

PROMPT_TEMPLATE = """
당신은 미국 연극, 브로드웨이, 할리우드 소식을 한국의 공연 예술가들과 관객들에게 전달하는 전문적이고 세련된 디지털 매거진 'Stage-Is'의 수석 에디터입니다.
아래 기사 본문과 추가 정보를 바탕으로 다음 3가지 항목을 작성해주세요.

[기사 정보]
- 원문 기사: {content}
- Reddit 반응: {reddit_info}

[작성 지침]
- 매거진 톤앤매너: 미니멀하고 세련된 문체. 뉴스 출처(예: Variety, Deadline, Playbill 등)는 전혀 언급하지 마십시오. 오직 사건 자체에만 집중합니다.
- title_kr (제목): 원래 기사의 제목을 한국어로 번역하되, 어그로를 끄는 식학이 아니라 깊이 있고 시적인 '헤드라인' 스타일로 작성하세요. (단순 번역 지양)
- summary_kr (요약): 기사의 핵심 내용을 2~3문장으로 간결하고 임팩트 있게 요약하세요.
- content_kr (본문 HTML): 원문 기사를 토대로 하되, 매거진 독자가 읽기 편하게 HTML 포맷으로 작성. 
  * 본문 내용은 원문 기사를 충실히 번역 및 의역하여 3~4개의 문단으로 구성하세요.
  * <p> 태그 안에 텍스트를 담고, 중간에 <blockquote>나 <ul>/<li>를 적절히 활용하여 시각적 즐거움을 주세요.
  * 기사 끝에는 반드시 '<h3>[에디터의 시선]</h3>'을 추가하고 이 기사에 대한 에디터의 깊이 있는 통찰을 한 문단으로 추가하세요.
  * 그 다음 '<h3>[현지 팬들의 시선: POSITIVE & NEGATIVE]</h3>'을 추가하고, 주어진 Reddit 반응을 참고하여 긍정/부정적 반응을 짧게 요약하세요.
  * 절대 원본 출처 사이트를 언급하지 마세요.

결과물은 반드시 아래 JSON 포맷을 정확히 지켜야 합니다. markdown 코드 블록은 없어야 하며 오직 순수한 JSON 문자열만 반환하세요.
{{
    "title_kr": "...",
    "summary_kr": "...",
    "content_kr": "..."
}}
"""

def generate(url, reddit):
    d = trafilatura.fetch_url(url)
    text = trafilatura.extract(d) if d else ""
    if not text:
        return None
    prompt = PROMPT_TEMPLATE.format(content=text[:5000], reddit_info=reddit)
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=prompt,
        )
        t = response.text.strip()
        if t.startswith("```json"): t = t[7:]
        if t.endswith("```"): t = t[:-3]
        return json.loads(t)
    except Exception as e:
        print(f"Error parse JSON: {e}")
        return None

with open('data/articles.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

updated = False
for a in data:
    if a.get('content_kr') == "본문을 처리하지 못했습니다." or not a.get('content_kr') or "오류가 발생했습니다" in a.get('summary_kr', ''):
        print(f"Translating: {a['original_title']}")
        res = generate(a['link'], a.get('reddit_reaction_kr', ''))
        if res:
            a['title_kr'] = res.get('title_kr', a['title_kr'])
            a['summary_kr'] = res.get('summary_kr', a['summary_kr'])
            a['content_kr'] = res.get('content_kr', a['content_kr'])
            updated = True
        time.sleep(3)

if updated:
    with open('data/articles.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print("Done")
else:
    print("No updates")
