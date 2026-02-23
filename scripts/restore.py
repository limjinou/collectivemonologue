import os
import re

# 1. CSS Merge
with open('css/style_old.css', 'r', encoding='utf-16') as f:
    old_css = f.read()

neo_brutal_additions = """
/* =========================================================
   COOKIE BANNER (Neo-Brutalism)
   ========================================================= */
.cookie-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background-color: var(--color-surface);
  border-top: var(--brutal-border);
  padding: 1.5rem 2rem;
  z-index: 9999;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 -8px 0px var(--color-border);
  font-family: var(--font-main);
  transform: translateY(100%);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.cookie-banner.show { transform: translateY(0); }
.cookie-text {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.6;
  max-width: 800px;
  margin-right: 2rem;
}
.cookie-buttons {
  display: flex;
  gap: 1rem;
  flex-shrink: 0;
}
.cookie-btn {
  padding: 0.75rem 1.5rem;
  font-family: var(--font-main);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  border: var(--brutal-border);
  background-color: var(--color-bg);
  box-shadow: 4px 4px 0px var(--color-border);
  transition: all 0.2s ease;
}
.cookie-btn.accept {
  background-color: var(--color-accent-pink);
}
.cookie-btn:hover {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0px var(--color-border);
}
@media (max-width: 768px) {
  .cookie-banner { flex-direction: column; padding: 1.5rem; box-shadow: 0 -4px 0px var(--color-border); }
  .cookie-text { margin-right: 0; margin-bottom: 1rem; font-size: 0.8rem; }
  .cookie-buttons { width: 100%; justify-content: flex-end; }
  .cookie-btn { width: 100%; }
}

/* =========================================================
   SCROLL TO TOP BUTTON (Neo-Brutalism)
   ========================================================= */
#scrollToTopBtn {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 50px;
  height: 50px;
  background-color: var(--color-accent-yellow);
  color: var(--color-text);
  border: var(--brutal-border);
  border-radius: 0;
  font-size: 1.5rem;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 4px 4px 0px var(--color-border);
  opacity: 0;
  visibility: hidden;
  transform: translateY(20px);
  transition: all 0.2s ease;
  z-index: 9998;
}
#scrollToTopBtn.show { opacity: 1; visibility: visible; transform: translateY(0); }
#scrollToTopBtn:hover {
  background-color: var(--color-accent-pink);
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0px var(--color-border);
}
@media (max-width: 768px) {
  #scrollToTopBtn { bottom: 6.5rem; right: 1.5rem; width: 45px; height: 45px; font-size: 1.25rem; }
}

/* =========================================================
   MAGAZINE CONTENT (HTML Formatting for Details)
   ========================================================= */
.single-article-content h3 {
  font-family: var(--font-display);
  font-size: 1.5rem;
  margin: 2rem 0 1rem;
  border-bottom: var(--brutal-border);
  padding-bottom: 0.5rem;
}
.single-article-content blockquote {
  font-size: 1.1rem;
  font-weight: 600;
  border-left: var(--brutal-border);
  margin: 1.5rem 0;
  padding: 1rem 1.5rem;
  background-color: var(--color-accent-yellow);
  box-shadow: var(--brutal-shadow);
}
.single-article-content ul {
  list-style-type: square;
  margin: 1rem 0;
  padding-left: 1.5rem;
}
.single-article-content li {
  margin-bottom: 0.5rem;
}
"""

with open('css/style.css', 'w', encoding='utf-8') as f:
    f.write(old_css + "\n" + neo_brutal_additions)

# 2. HTML Restorations
for file in ['index.html', 'article.html', 'category.html']:
    with open(f'{file}', 'r', encoding='utf-8') as f:
        new_html = f.read()
    with open(f'{file.replace(".html", "_old.html")}', 'r', encoding='utf-16') as f:
        old_html = f.read()
    
    scripts_match = re.search(r'(<!-- Google AdSense -->.*?</script>\s*<!-- Google Analytics GA4 -->.*?</script>\s*<script>.*?</script>\s*<!-- Microsoft Clarity -->.*?</script>\s*)', new_html, re.DOTALL)
    if scripts_match:
        scripts = scripts_match.group(1)
        old_html = old_html.replace('</head>', f'{scripts}</head>')
    
    ad_match = re.search(r'(<!-- ===== Google AdSense 배너.*?</div>\s*</div>)', new_html, re.DOTALL)
    if ad_match:
        ad_banner = ad_match.group(1) # We use the ad banner as string.
        old_html = old_html.replace('<!-- ===== 푸터', f'{ad_banner}\n\n  <!-- ===== 푸터')

    with open(file, 'w', encoding='utf-8') as f:
        f.write(old_html)

print("Merge Script Completed")
