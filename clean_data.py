import json
import os

list_path = 'data/articles_list.json'

def clean_json():
    try:
        with open(list_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            # Try to fix basic JSON structure if broken
            if not content.strip().endswith(']'):
                content = content.strip() + ']'
            data = json.loads(content)
        
        # Filter out items with error messages
        cleaned_data = []
        for item in data:
            summary = item.get('summary_kr', '')
            if '정보를 불러오지 못했습니다' not in summary and '과부하' not in summary:
                cleaned_data.append(item)
        
        with open(list_path, 'w', encoding='utf-8') as f:
            json.dump(cleaned_data, f, ensure_ascii=False, indent=4)
        print(f"✅ Cleaned {len(data) - len(cleaned_data)} corrupted entries.")
    except Exception as e:
        print(f"❌ Failed to clean JSON: {e}")

if __name__ == "__main__":
    clean_json()
