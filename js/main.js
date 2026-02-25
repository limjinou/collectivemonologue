/* ============================================
   Stageside — Minimalist Redesign JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  setupHeaderDate();

  // Routing
  if (document.getElementById('article-grid')) {
    loadArticles();
  } else if (document.body.classList.contains('single-article')) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('id')) {
      renderSingleArticle();
    }
  } else if (document.body.classList.contains('category-page')) {
    renderCategoryArticles();
  }

  if (typeof initCookieBanner === 'function') {
    initCookieBanner();
  }
});

/* --- Header Date Setup --- */
function setupHeaderDate() {
  const dateElements = document.querySelectorAll('#header-left-date');
  if (!dateElements.length) return;

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const formattedDate = `${year}.${month}.${day}`;

  dateElements.forEach(el => {
    el.innerHTML = `<a href="index.html" style="text-decoration:none; color:inherit;">${formattedDate}</a>`;
  });
}

/* --- Data Loading & Rendering for Grid --- */
/**
 * 홈 화면의 기사 그리드를 렌더링합니다.
 * 본문 제외 목록 데이터(articles_list.json)만 로드하여 속도를 최적화합니다.
 */
async function loadArticles() {
  const grid = document.getElementById('article-grid');
  if (!grid) return;

  try {
    const basePath = window.location.pathname.includes('/collectivemonologue') ? '/collectivemonologue/' : '/';
    // 경량화된 목록 데이터 로드
    const response = await fetch(`${basePath}data/articles_list.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('Failed to load articles_list.json');
    const articles = await response.json();

    grid.innerHTML = ''; // Loading 상태 제거

    articles.forEach((article) => {
      const item = document.createElement('a');
      // 인덱스 대신 고유 ID(slug)를 사용한 링크 생성
      item.href = `article.html?id=${article.id}`;
      item.className = 'grid-item';

      const imageHtml = article.image
        ? `<img src="${article.image}" alt="${article.title}" class="grid-item-image">`
        : `<div class="grid-item-image" style="background:#f4f4f4;"></div>`;

      let summary = article.summary_kr || article.title;
      if (summary.length > 150) summary = summary.substring(0, 150) + '...';

      item.innerHTML = `
              <div class="grid-item-image-wrapper">${imageHtml}</div>
              <div class="grid-item-title">${article.title_kr || article.title}</div>
              <div class="grid-item-summary">${summary}</div>
          `;
      grid.appendChild(item);
    });
  } catch (e) {
    console.error('Error fetching data:', e);
    grid.innerHTML = '<div style="grid-column: 1/-1; padding-top: 50px;">Articles could not be loaded at this time.</div>';
  }
}

/* --- Render Single Article Detail Page --- */
/**
 * 기사 상세 페이지를 렌더링합니다.
 * URL의 id(slug)를 기반으로 해당 기사의 전용 JSON 파일을 로드합니다.
 */
async function renderSingleArticle() {
  const urlParams = new URLSearchParams(window.location.search);
  const articleId = urlParams.get('id'); // 이제 숫자가 아닌 slug ID임

  if (!articleId) {
    document.querySelector('.article-page').innerHTML = '<p>기사를 찾을 수 없습니다.</p>';
    return;
  }

  try {
    const basePath = window.location.pathname.includes('/collectivemonologue') ? '/collectivemonologue/' : '/';
    // 개별 기사 본문 데이터만 타겟팅하여 로드 (가장 효율적임)
    const response = await fetch(`${basePath}data/articles/${articleId}.json?t=${new Date().getTime()}`);

    if (!response.ok) {
      // 하위 호환성: 만약 slug 파일이 없으면 기존 인덱스 방식일 수도 있음 (전환기 대비)
      // 하지만 여기서는 깔끔하게 새 방식만 처리하거나 에러 핸들링
      throw new Error('Article data not found');
    }

    const article = await response.json();

    // Title & Meta 설정
    const titleText = article.title_kr || article.title;
    document.title = `${titleText} | Stageside`;
    document.querySelector('.article-title').textContent = titleText;

    // --- Dynamic SEO Meta Update ---
    const description = article.summary_kr || "Stageside의 고품격 연극/영화 분석 리포트";
    const imageUrl = article.image || "";
    const canonicalUrl = window.location.href;

    // Meta Description & Canonical
    updateMeta('name', 'description', description);
    updateLink('canonical', canonicalUrl);

    // Open Graph
    updateMeta('property', 'og:title', titleText);
    updateMeta('property', 'og:description', description);
    updateMeta('property', 'og:image', imageUrl);
    updateMeta('property', 'og:url', canonicalUrl);

    // X (Twitter) Card
    updateMeta('name', 'twitter:title', titleText);
    updateMeta('name', 'twitter:description', description);
    updateMeta('name', 'twitter:image', imageUrl);

    // JSON-LD Update
    updateStructuredData(article);

    let formattedDate = article.date;
    try {
      const d = new Date(article.date);
      const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
      formattedDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${days[d.getDay()]}`;
    } catch (e) { /* keep string */ }

    document.querySelector('.article-meta').innerHTML = `<span>${formattedDate}</span>`;

    // 이미지 처리
    const heroContainer = document.querySelector('.article-hero-image-wrapper');
    if (article.image) {
      heroContainer.innerHTML = `<img src="${article.image}" alt="${titleText} - Stageside의 분석 리포트 이미지" class="fade-in">`;
      heroContainer.style.display = 'block';
    } else {
      heroContainer.style.display = 'none';
    }

    // 본문 렌더링
    const contentHtml = article.content_kr || article.summary_kr || "<p>본문 내용이 없습니다.</p>";
    const attributionHtml = `<p style="margin-top: 80px; font-size: 12px; font-weight: 500; color: #666; text-transform: none; text-align: center;">스테이지사이드 편집부에 의해 작성된 글입니다.</p>`;
    document.querySelector('.article-body').innerHTML = contentHtml + attributionHtml;

  } catch (error) {
    console.error('Error rendering article:', error);
    document.querySelector('.article-page').innerHTML = '<p>기사를 불러오는 중 오류가 발생했습니다. (데이터 형식이 변경되었거나 존재하지 않는 기사입니다)</p>';
  }
}

/* --- Category Page Rendering (Slight variant of Grid) --- */
async function renderCategoryArticles() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetCategory = urlParams.get('cat');
  const grid = document.getElementById('category-grid');

  if (!grid || !targetCategory) return;

  // Update header context
  const catTitle = document.getElementById('category-title');
  if (catTitle) {
    catTitle.textContent = targetCategory.toUpperCase();
  }

  try {
    const basePath = window.location.pathname.includes('/collectivemonologue') ? '/collectivemonologue/' : '/';
    const response = await fetch(`${basePath}data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('Data fetch failed');
    const articles = await response.json();

    const filtered = articles.filter(a => {
      // 모든 기사는 기본적으로 연극 관련이라고 간주하고 노출 (또는 필요시 theater 파라미터 체크)
      if (targetCategory === 'theater') return true;
      return false;
    });

    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1/-1;">No articles found in this category.</div>';
      return;
    }

    filtered.forEach((article) => {
      // find original index for link
      const index = articles.indexOf(article);
      const item = document.createElement('a');
      item.href = `article.html?id=${index}`;
      item.className = 'grid-item';

      const imageHtml = article.image
        ? `<img src="${article.image}" class="grid-item-image">`
        : `<div class="grid-item-image" style="background:#f4f4f4;"></div>`;

      let summary = article.summary_kr || article.title;
      if (summary.length > 150) summary = summary.substring(0, 150) + '...';

      item.innerHTML = `
              <div class="grid-item-image-wrapper">${imageHtml}</div>
              <div class="grid-item-summary">${summary}</div>
          `;
      grid.appendChild(item);
    });
  } catch (e) {
    console.error('Error fetching data:', e);
  }
}

/* --- Cookie Banner --- */
function initCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  const btnAccept = document.getElementById('acceptCookies');
  const btnReject = document.getElementById('rejectCookies');

  if (!banner || !btnAccept || !btnReject) return;

  if (!localStorage.getItem('cookieConsent')) {
    banner.style.display = 'flex';
  }

  btnAccept.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'accepted');
    banner.style.display = 'none';
  });

  btnReject.addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'rejected');
    banner.style.display = 'none';
  });
}

// Add init function to DOMContentLoaded (needs to be patched at top usually, but we can just call it here)
document.addEventListener('DOMContentLoaded', () => {
  initCookieBanner();
});

/* --- SEO Helpers --- */
function updateMeta(attr, value, content) {
  let meta = document.querySelector(`meta[${attr}="${value}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attr, value);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

function updateLink(rel, href) {
  let link = document.querySelector(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', rel);
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function updateStructuredData(article) {
  const scriptTag = document.getElementById('structured-data');
  if (!scriptTag) return;

  const title = article.title_kr || article.title;
  const description = article.summary_kr || "";
  const imageUrl = article.image || "";
  const datePublished = article.date ? new Date(article.date).toISOString() : new Date().toISOString();

  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": title,
    "description": description,
    "image": [imageUrl],
    "datePublished": datePublished,
    "dateModified": datePublished,
    "author": {
      "@type": "Organization",
      "name": "Stageside",
      "url": "https://limjinou.github.io/collectivemonologue/"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Stageside",
      "logo": {
        "@type": "ImageObject",
        "url": "https://limjinou.github.io/collectivemonologue/assets/logo.png"
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": window.location.href
    }
  };

  scriptTag.text = JSON.stringify(data);
}
