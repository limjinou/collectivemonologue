import json
import re
import os

def offline_reformat(content):
    if not content:
        return content
    
    # 1. 소제목 변경: Pro & Con -> POSITIVE & NEGATIVE
    content = content.replace("<h3>[현지 팬들의 시선: Pro & Con]</h3>", "<h3>[현지 팬들의 시선: POSITIVE & NEGATIVE]</h3>")
    content = content.replace("[현지 팬들의 시선: Pro & Con]", "[현지 팬들의 시선: POSITIVE & NEGATIVE]")
    
    # 2. 리스트 아이템 내 키워드 변경
    content = content.replace("<li><b>Pro", "<li><b>POSITIVE")
    content = content.replace("<li><b>Con", "<li><b>NEGATIVE")
    content = content.replace("<b>Pro (", "<b>POSITIVE (")
    content = content.replace("<b>Con (", "<b>NEGATIVE (")
    content = content.replace("<b>Pro:", "<b>POSITIVE:")
    content = content.replace("<b>Con:", "<b>NEGATIVE:")
    
    # 3. 특정 플랫폼 명칭 배제 (일반 명사로 대체)
    # Reddit/레딧 관련
    content = re.sub(r'Reddit\(레딧\)', '현지 커뮤니티', content, flags=re.I)
    content = re.sub(r'\(Reddit 등\)', '(현지 커뮤니티 등)', content, flags=re.I)
    content = re.sub(r'레딧\(Reddit\)', '현지 온라인 커뮤니티', content, flags=re.I)
    content = re.sub(r'레딧의 팬들', '현지 커뮤니티의 팬들', content, flags=re.I)
    content = re.sub(r'레딧', '현지 커뮤니티', content, flags=re.I)
    content = re.sub(r'Reddit', '현지 커뮤니티', content, flags=re.I)
    
    # Wikipedia/위키피디아 관련
    content = re.sub(r'Wikipedia', '사전적 의미', content, flags=re.I)
    content = re.sub(r'위키피디아', '사전적 의미', content, flags=re.I)
    
    # 4. [편집자 주] 형식을 <h3>[에디터의 시선]</h3> 로 통일 (있을 경우)
    if "[편집자 주]" in content and "<h3>[에디터의 시선]</h3>" not in content:
        content = content.replace("[편집자 주]", "<h3>[에디터의 시선]</h3>")

    return content

def main():
    json_path = "data/articles.json"
    if not os.path.exists(json_path):
        print("File not found.")
        return
        
    with open(json_path, 'r', encoding='utf-8') as f:
        articles = json.load(f)
        
    for article in articles:
        if "content_kr" in article:
            old_content = article["content_kr"]
            new_content = offline_reformat(old_content)
            article["content_kr"] = new_content
            
        # reddit_reaction_kr 필드가 따로 있다면 거기서도 Reddit 단어 제거
        if "reddit_reaction_kr" in article:
            article["reddit_reaction_kr"] = offline_reformat(article["reddit_reaction_kr"])
            
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(articles, f, ensure_ascii=False, indent=4)
        
    print(f"Successfully updated {len(articles)} articles offline.")

if __name__ == "__main__":
    main()
