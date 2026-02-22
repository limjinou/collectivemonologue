import os
import re

files = ['index.html', 'article.html', 'category.html', 'about.html', 'contact.html', 'privacy.html']
logo_text_html = '<a href="index.html" style="text-decoration: none; color: inherit; font-size: 1.2rem; font-weight: 600; letter-spacing: 0.1em;">COLLECTIVE MONOLOGUE</a>'

for file in files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace header-center content (remove <img>, insert text)
        content = re.sub(r'<div class="header-center">.*?</div>', f'<div class="header-center">{logo_text_html}</div>', content, flags=re.DOTALL)
        
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)

print("HTML header logos replaced with text successfully.")
