import os

replacements = {
    "STAGE-IS": "STAGE-IS",
    "Stage-Is": "Stage-Is",
    "stageside": "stageside",
    "스테이지이즈": "스테이지이즈",
    "스테이지이즈": "스테이지이즈",
    "스테이지이즈": "스테이지이즈"
}

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original = content
        for old, new in replacements.items():
            content = content.replace(old, new)
            
        if original != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Updated: {filepath}")
    except Exception as e:
        print(f"Error processing {filepath}: {e}")

# Process specific directories and file types
target_extensions = ('.html', '.js', '.css', '.json', '.py', '.md', '.txt')

for root, dirs, files in os.walk('.'):
    # Skip ignored directories
    if any(ignore in root for ignore in ['.git', '.gemini', 'node_modules']):
        continue
        
    for file in files:
        if file.endswith(target_extensions):
            process_file(os.path.join(root, file))

print("Brand name replacement completed.")
