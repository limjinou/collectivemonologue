import json
import os
import time
import google.generativeai as genai

# crawler.py에서 설정 가져오기
try:
    import crawler
    model = crawler.model
except Exception as e:
    print("crawler.py 의존성을 불러오는데 실패했습니다:", e)
    exit(1)

def reformat_article(article):
    # 기존 한국어 본문을 가져옵니다.
    content_kr = article.get("content_kr", "")
    
    if not content_kr:
        return article

    prompt = f"""
    당신은 'Collective Monologue'의 수석 에디터입니다. 아래 제공된 기존 한국어 기사 본문을 읽고, 새로운 가이드라인에 맞게 '내용의 훼손 없이' 형식만 수정하여 JSON으로 반환해주세요.

    [수정 가이드라인]
    1. **소제목 변경**: 기존 `<h3>[현지 팬들의 시선: Pro & Con]</h3>` 부분을 찾아 `<h3>[현지 팬들의 시선: POSITIVE & NEGATIVE]</h3>`로 변경하세요 (내용의 기조는 유지).
    2. **출처 명칭 배제**: 본문 내에서 'Reddit', '레딧', 'Wikipedia', '위키피디아' 등의 конкрет(구체적인) 커뮤니티나 플랫폼 이름이 있다면 이를 모두 "현지 커뮤니티", "온라인 반응", "사전적 의미" 등 포괄적인 일반 명사로 부드럽게 대체하세요.
    3. **에디터 톤 유지**: [용어 한 스푼] 등은 제미나이플래시 편집자의 시각에서 깔끔하게 서술된 형태로 다듬어주세요.
    4. **HTML 태그 유지**: 기존 기사의 `<p>`, `<h3>`, `<blockquote>`, `<ul>`, `<li>` 등의 구조를 그대로 아름답게 유지해야 합니다.
    5. **기타 내용 보존**: 원래 기사의 핵심 메시지나 번역된 내용은 절대 빼놓거나 요약해 버리지 말고 모두 포함시키세요.

    [기존 기사 본문]
    {content_kr}

    반환 형식 (Strict JSON):
    {{
        "content_kr": "가이드라인이 적용된 완전한 HTML 형태의 기사 본문 문자열"
    }}
    """
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            result = json.loads(response.text)
            
            # 성공적으로 파싱된 경우 적용
            if "content_kr" in result:
                article["content_kr"] = result["content_kr"]
                print(f" -> 성공적으로 포맷팅되었습니다: {article['original_title']}")
                return article
                
        except Exception as e:
            wait_time = 5 * (2 ** attempt)
            print(f" -> API 오류 (Attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
            time.sleep(wait_time)
            
    print(f" -> 포맷팅 실패: {article['original_title']}")
    return article

def main():
    json_path = "data/articles.json"
    
    if not os.path.exists(json_path):
        print(f"{json_path} 를 찾을 수 없습니다.")
        return
        
    with open(json_path, 'r', encoding='utf-8') as f:
        articles = json.load(f)
        
    print(f"총 {len(articles)}개의 기사를 업데이트합니다.")
    
    updated_articles = []
    for idx, article in enumerate(articles):
        print(f"[{idx+1}/{len(articles)}] {article.get('original_title', 'No Title')}")
        updated_article = reformat_article(article)
        updated_articles.append(updated_article)
        time.sleep(2) # API Rate Limit 방지용 대기
        
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(updated_articles, f, ensure_ascii=False, indent=4)
        
    print("완료되었습니다!")

if __name__ == "__main__":
    main()
