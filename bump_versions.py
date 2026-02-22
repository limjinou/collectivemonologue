import os
import re
from datetime import datetime

# 현재 시간 기반 버전 (YYYYMMDDHHMM)
new_version = datetime.now().strftime("%Y%m%d%H%M")
print(f"🚀 Bumping versions to: {new_version}")

html_files = [
    "index.html", 
    "article.html", 
    "about.html", 
    "contact.html", 
    "category.html", 
    "privacy.html"
]

# 정규표현식: css/style.css?v=... 또는 js/main.js?v=...
css_pattern = re.compile(r'href="css/style\.css\?v=[\d]+"')
js_pattern = re.compile(r'src="js/main\.js\?v=[\d]+"')

for filename in html_files:
    if not os.path.exists(filename):
        print(f"⚠️ Skipping {filename} (not found)")
        continue
        
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = css_pattern.sub(f'href="css/style.css?v={new_version}"', content)
    new_content = js_pattern.sub(f'src="js/main.js?v={new_version}"', new_content)
    
    if content != new_content:
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✅ Updated {filename}")
    else:
        print(f"ℹ️ No change in {filename} (pattern might not match)")

print("✨ Done!")
