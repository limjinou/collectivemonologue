import os
import re

static_files = ['about.html', 'contact.html', 'privacy.html']

for file in static_files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Change <body class="single-article"> to <body class="static-page">
        # Use regex to handle potential variations in quotes/spaces
        new_content = re.sub(r'<body\s+class=["\']single-article["\']>', '<body class="static-page">', content)
        
        if new_content != content:
            with open(file, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated {file}")
        else:
            print(f"No changes needed for {file} (already updated or pattern not found)")
