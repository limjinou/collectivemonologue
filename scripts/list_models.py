import os
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

try:
    models = client.models.list()
    for m in models:
        print(f"Model: {m.name} | Display: {m.display_name}")
except Exception as e:
    print(f"Error: {e}")
