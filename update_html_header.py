import os
import re

files = ['index.html', 'article.html', 'category.html', 'about.html', 'contact.html', 'privacy.html']
logo_html = '<a href="index.html" style="display: flex; justify-content: center; align-items: center;"><img src="assets/logo.png" alt="Collective Monologue" style="height: 40px; filter: grayscale(1);"></a>'

for file in files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace header-center content
        # Looking for <div class="header-center">...</div>
        content = re.sub(r'<div class="header-center">.*?</div>', f'<div class="header-center">{logo_html}</div>', content, flags=re.DOTALL)
        
        # Ensure header-left has the correct ID if it doesn't already
        # Looking for <div class="header-left"...>...</div>
        if 'id="header-left-date"' not in content:
            content = re.sub(r'<div class="header-left".*?>.*?</div>', '<div class="header-left" id="header-left-date"></div>', content, flags=re.DOTALL)
        
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)

print("HTML files updated successfully.")
