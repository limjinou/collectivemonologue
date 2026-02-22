/* ============================================
   Collective Monologue — Minimalist Redesign JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  setupHeaderDate();

  // Routing
  if (document.getElementById('article-grid')) {
    loadArticles();
  } else if (document.body.classList.contains('single-article')) {
    renderSingleArticle();
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
async function loadArticles() {
  const grid = document.getElementById('article-grid');
  if (!grid) return;

  try {
    // Robust Pathing: handle local vs GitHub Pages environments
    const basePath = window.location.pathname.includes('/collectivemonologue') ? '/collectivemonologue/' : '/';
    const response = await fetch(`${basePath}data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('Failed to load articles.json');
    const articles = await response.json();

    grid.innerHTML = ''; // Clear loading state

    articles.forEach((article, index) => {
      const item = document.createElement('a');
      item.href = `article.html?id=${index}`;
      item.className = 'grid-item';

      // Clean, minimalist thumbnail wrapper
      const imageHtml = article.image
        ? `<img src="${article.image}" alt="${article.title}" class="grid-item-image">`
        : `<div class="grid-item-image" style="background:#f4f4f4;"></div>`;

      // Clean summary snippet (remove AI failure notes or truncations gracefully)
      let summary = article.summary_kr && !article.summary_kr.startsWith('[번역 실패]')
        ? article.summary_kr
        : article.title;
      if (summary.length > 150) summary = summary.substring(0, 150) + '...';

      // Pure, unstyled text layout
      // Title over Source as per user request
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
async function renderSingleArticle() {
  const urlParams = new URLSearchParams(window.location.search);
  const articleId = urlParams.get('id');

  if (articleId === null) {
    document.querySelector('.article-page').innerHTML = '<p>기사를 찾을 수 없습니다.</p>';
    return;
  }

  try {
    const basePath = window.location.pathname.includes('/collectivemonologue') ? '/collectivemonologue/' : '/';
    const response = await fetch(`${basePath}data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('Data fetch failed');
    const articles = await response.json();
    const article = articles[articleId];

    if (!article) {
      document.querySelector('.article-page').innerHTML = '<p>해당 기사가 존재하지 않습니다.</p>';
      return;
    }

    // Title & Date formatting
    document.title = `${article.title_kr || article.title} | Collective Monologue`;
    document.querySelector('.article-title').textContent = article.title_kr || article.title;

    let formattedDate = article.date;
    try {
      const d = new Date(article.date);
      const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dayName = days[d.getDay()];
      formattedDate = `${year}.${month}.${day}.${dayName}`;
    } catch (e) { /* keep string as is */ }

    document.querySelector('.article-meta').innerHTML = `
          <span>${formattedDate}</span>
      `;

    // Hero Image Layout
    const heroContainer = document.querySelector('.article-hero-image-wrapper');
    if (article.image) {
      heroContainer.innerHTML = `<img src="${article.image}" alt="${article.title}">`;
    } else {
      heroContainer.style.display = 'none';
    }

    // Body Content
    const contentHtml = article.content_kr || article.summary_kr || "<p>본문 내용이 없습니다.</p>";
    const attributionHtml = `<p style="margin-top: 80px; font-size: 12px; font-weight: 500; color: #666; text-transform: none; text-align: center;">콜렉티브 모놀로그 편집부에 의해 작성된 글입니다.</p>`;
    document.querySelector('.article-body').innerHTML = contentHtml + attributionHtml;

  } catch (error) {
    console.error('Error rendering article:', error);
    document.querySelector('.article-page').innerHTML = '<p>기사를 불러오는 중 오류가 발생했습니다.</p>';
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
