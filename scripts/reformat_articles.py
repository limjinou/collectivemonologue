import os
import json
import time
from dotenv import load_dotenv
from google import genai

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=GEMINI_API_KEY)
model_id = 'gemini-2.5-pro'

PROMPT_TEMPLATE = """
당신은 미국 연극, 영화, 할리우드 소식을 한국의 예술가들과 관객들에게 전달하는 디지털 매거진 'STAGE-IS'의 수석 에디터입니다.
아래의 기존 기사 본문과 메타데이터를 기반으로, 동일한 내용의 본문(`content_kr`)을 "완벽하게 통일된 HTML 구조"로 재작성(Reformat)하세요.

[수정되어야 할 엄격한 구조 규칙]
- 모든 문단은 반드시 `<p>내용</p>` 태그로 감싸야 합니다.
- 원문의 핵심 주장에 어울리는 중간 소제목이 보인다면 `<h3>소제목</h3>` 형태를 유지하거나 추가하세요.
- 내용 중 인용구가 있다면 `<blockquote>인용구 텍스트</blockquote>` 규칙을 사용하세요. (ex. "그 운명적인 밤...")
- 기사 끝에는 무조건 `<h3>[에디터의 시선]</h3>` 태그를 넣고 뒤이어 `<p>에디터 논평</p>` 본문을 추가하세요.
- 그 뒤에 무조건 `<h3>[현지 팬들의 시선: POSITIVE & NEGATIVE]</h3>` 태그를 넣고 `<ul>`과 `<li>`를 이용해 **POSITIVE** 와 **NEGATIVE** 의견을 요약하여 추가하세요. (Pro/Con 등 다른 단어 금지).
- 마지막으로 무조건 `<h3>[용어 한 스푼]</h3>` 섹션을 추가하고 기사와 관련된 브로드웨이/할리우드 전문 용어 1~2개를 선정하여 `<p>...</p>` 태그로 기재하세요. (필수사항)
  - [작성 메커니즘]: 위키피디아 등에서 공식 정의를 먼저 확인한 뒤, STAGE-IS의 수석 에디터로서 초보 관객과 무대 예술가들이 한눈에 이해할 수 있도록 쉽고 친절한 언어로 **완전히 재구성하여** 설명하세요. 사전적 정의를 그대로 복사해서는 안 됩니다.

[원본 데이터]
Title: {title}
Original Content/Summary: {original_content}

[반환 항목]
아래와 같이 순수한 JSON 형식만 반환하세요 (마크다운 포맷팅 제외, 따옴표 이스케이프 유의, 내용 유지).

{{
    "content_kr": "..."
}}
"""

def reformat_article(title, content):
    prompt = PROMPT_TEMPLATE.format(title=title, original_content=content)
    max_retries = 3
    for attempt in range(max_retries):
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
            err_msg = str(e)
            print(f"Error on {title} (Attempt {attempt+1}): {err_msg}")
            if "429" in err_msg or "quota" in err_msg.lower():
                wait_time = 30 # Default wait
                if "retryDelay" in err_msg:
                    try:
                        # Extract seconds from error message if possible
                        import re
                        match = re.search(r"'retryDelay':\s*'(\d+)s'", err_msg)
                        if match: wait_time = int(match.group(1)) + 2
                    except: pass
                print(f"Quota exceeded. Waiting for {wait_time}s...")
                time.sleep(wait_time)
            elif attempt < max_retries - 1:
                time.sleep(10)
            else:
                return None
    return None

if __name__ == "__main__":
    with open('data/articles.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    missing_indices = [1, 3, 4, 5, 6, 14, 15]
    updated = False
    for i in missing_indices:
        a = data[i]
        print(f"[{i+1}/{len(data)}] Reformatting (MISSING): {a['original_title']}")
        
        # Reformat using the current content or summary as context
        context = a.get('content_kr', '') + " " + a.get('summary_kr', '')
        res = reformat_article(a['original_title'], context)
        if res and 'content_kr' in res:
            a['content_kr'] = res['content_kr']
            updated = True
            with open('data/articles.json', 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"--- SUCCESS: {a['original_title']} saved. ---")
            print("Waiting 120s for safety...")
            time.sleep(120) 
        else:
            print(f"--- FAILED: {a['original_title']} ---")
            time.sleep(10)

    if updated:
        print("Final update of articles.json completed.")
    else:
        print("No articles were updated in this run.")
