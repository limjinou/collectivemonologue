/* ============================================
   Collective Monologue — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initMobileMenu();
  initScrollAnimations();
  initHeaderScroll();
  initTheme();

  // 현재 페이지 확인 후 적절한 함수 실행
  if (window.location.pathname.includes('article.html')) {
    renderSingleArticle();
  } else if (window.location.pathname.includes('category.html')) {
    renderCategoryArticles();
  } else {
    loadArticles();
    loadBoxOffice(); // 새로운 박스오피스 & 추천작 위젯 로드
  }
});

/* --- 공통 유틸리티 --- */
function formatKoreanDate(dateString) {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // 파싱 실패시 원본 반환

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}. ${month}. ${day}. ${hours}:${minutes}`;
  } catch (e) {
    return dateString;
  }
}

/* --- 기사 데이터 로드 및 렌더링 --- */
async function loadArticles() {
  const container = document.querySelector('.article-list');
  if (!container) return;

  try {
    const response = await fetch(`data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('데이터 로드 실패');
    const articles = await response.json();

    container.innerHTML = '';

    articles.forEach((article, index) => {
      const category = article.source === 'Variety' ? 'FILM' : 'THEATER';
      const summary = article.summary_kr && !article.summary_kr.startsWith('[번역 실패]')
        ? article.summary_kr
        : (article.title);

      // 썸네일 이미지 처리
      const imageHtml = article.image
        ? `<div class="article-thumbnail" style="background-image: url('${article.image}');"></div>`
        : `<div class="article-thumbnail placeholder-mixed"></div>`;

      const item = document.createElement('a');
      // 링크를 내부 article.html 페이지로 연동 (기사 인덱스 파라미터 전달)
      item.href = `article.html?id=${index}`;
      item.className = 'article-item';

      item.innerHTML = `
        ${imageHtml}
        <div class="article-info">
          <div class="article-content">
            <h3 class="article-title">${article.title_kr || article.title}</h3>
            <div class="article-meta">
              <span class="meta-category">${category}</span>
              <span class="meta-date">${formatKoreanDate(article.date)}</span>
            </div>
          </div>
          <p class="article-summary">${summary}</p>
        </div>
      `;
      container.appendChild(item);
    });

  } catch (error) {
    console.error('Error:', error);
    container.innerHTML = '<p style="padding:2rem;">최신 뉴스를 불러오는 중입니다...</p>';
  }
}

/* --- 박스오피스 및 추천작 데이터 로드 --- */
async function loadBoxOffice() {
  const bwayContainer = document.getElementById('broadway-widget-content');
  const recContainer = document.getElementById('recommendation-widget-content');

  if (!bwayContainer || !recContainer) return;

  try {
    const response = await fetch(`data/boxoffice.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('Box office data loaded failed');
    const data = await response.json();

    // 1. 브로드웨이 랭킹 렌더링
    if (data.broadway && data.broadway.length > 0) {
      bwayContainer.innerHTML = '';
      data.broadway.forEach(item => {
        const el = document.createElement('div');
        el.className = 'bway-item';
        const descLine = item.description_kr ? `<div class="bway-desc">${item.description_kr}</div>` : '';
        const theaterLine = item.theater ? `<span class="bway-theater">📍 ${item.theater}</span>` : '';
        el.innerHTML = `
          <div class="bway-rank-box">
            <span class="bway-rank-num">${item.rank}</span>
          </div>
          <div class="bway-info">
            <div class="bway-header-row">
              <h4>${item.show}</h4>
              ${theaterLine}
            </div>
            ${descLine}
            <div class="bway-stats-compact">
              <span>💰 ${item.gross_formatted}</span>
              <span>🎫 ${item.avg_ticket || '-'}</span>
              <span>👥 ${item.attendance || '-'}</span>
              <span>📊 ${item.capacity}</span>
            </div>
          </div>
        `;
        bwayContainer.appendChild(el);
      });
    } else {
      bwayContainer.innerHTML = '<p class="bway-stats">이번 주 랭킹 데이터가 없습니다.</p>';
    }

    // 2. 오프브로드웨이 추천작 렌더링
    if (data.recommendations && data.recommendations.length > 0) {
      recContainer.innerHTML = '';
      data.recommendations.forEach(item => {
        const el = document.createElement('div');
        el.className = 'rec-item';
        el.innerHTML = `
          <h4>${item.title}</h4>
          <p>${item.reason}</p>
        `;
        recContainer.appendChild(el);
      });
    } else {
      recContainer.innerHTML = '<p class="bway-stats">이번 주 추천작이 없습니다.</p>';
    }

  } catch (error) {
    console.error('Box Office load error:', error);
    bwayContainer.innerHTML = '<p class="bway-stats">데이터를 불러오지 못했습니다.</p>';
    recContainer.innerHTML = '<p class="bway-stats">데이터를 불러오지 못했습니다.</p>';
  }
}

/* --- 단일 기사 페이지 렌더링 --- */
async function renderSingleArticle() {
  const urlParams = new URLSearchParams(window.location.search);
  const articleId = urlParams.get('id');

  if (articleId === null) {
    document.querySelector('.single-article-content').innerHTML = '<p>기사를 찾을 수 없습니다.</p>';
    return;
  }

  try {
    const response = await fetch(`data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('데이터 로드 실패');
    const articles = await response.json();

    const article = articles[articleId];
    if (!article) {
      document.querySelector('.single-article-content').innerHTML = '<p>해당 기사가 존재하지 않습니다.</p>';
      return;
    }

    const category = article.source === 'Variety' ? '영화' : '연극';

    // 내용 채우기
    document.querySelector('.hero-category').textContent = `🎭 ${category}`;
    document.querySelector('.article-title').textContent = article.title_kr || article.title;
    document.querySelector('.article-meta-bar').innerHTML = `
      <span>${article.source}</span>
      <span class="divider" style="display:inline-block;width:4px;height:4px;border-radius:50%;background:var(--color-text-dim);"></span>
      <span>${formatKoreanDate(article.date)}</span>
      <span class="divider" style="display:inline-block;width:4px;height:4px;border-radius:50%;background:var(--color-text-dim);"></span>
      <a href="${article.link}" target="_blank" style="text-decoration:underline;">원본 기사 보기</a>
    `;

    // 이미지 넣기
    const featuredImageContainer = document.querySelector('.article-featured-image');
    if (article.image) {
      featuredImageContainer.innerHTML = `<img src="${article.image}" alt="Article Thumbnail" style="width:100%; border-radius:var(--radius); margin-bottom: 2rem;">`;
    } else {
      featuredImageContainer.style.display = 'none';
    }

    // 본문 내용 (개행 문자를 p태그로 분리)
    const contentHtml = (article.content_kr || article.summary_kr || "본문 내용이 없습니다.")
      .split('\n\n')
      .map(p => `<p>${p}</p>`)
      .join('');

    const extraInfoHtml = `<p><em>이 기사는 <b>${article.source}</b>에서 스크랩 되었으며 AI에 의해 한국어로 요약되었습니다.</em></p>`;
    document.querySelector('.single-article-content').innerHTML = contentHtml + extraInfoHtml;

  } catch (error) {
    console.error('Error:', error);
    document.querySelector('.single-article-content').innerHTML = '<p>기사를 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/* --- 카테고리 기사 리스트 렌더링 --- */
async function renderCategoryArticles() {
  const params = new URLSearchParams(window.location.search);
  const currentCategory = params.get('cat') || 'theater'; // 기본값 연극

  const containerId = currentCategory === 'theater' ? 'theaterArticles' : 'filmArticles';
  const container = document.getElementById(containerId);
  const isTheater = currentCategory === 'theater';

  if (!container) return;

  try {
    const response = await fetch(`data/articles.json?t=${new Date().getTime()}`);
    if (!response.ok) throw new Error('데이터 로드 실패');

    const articles = await response.json();

    // 카테고리 필터링 (Variety면 영화, 그 외엔 연극으로 분류)
    const filteredArticles = articles.filter(article => {
      const isArticleFilm = article.source === 'Variety';
      return isTheater ? !isArticleFilm : isArticleFilm;
    });

    container.innerHTML = ''; // 빈 상태로 초기화 (기존 더미 삭제)

    if (filteredArticles.length === 0) {
      container.innerHTML = `<p style="grid-column: 1 / -1; padding: 3rem 0; text-align: center; font-size: 1.1rem; color: var(--color-text-muted);">아직 등록된 기사가 없습니다.</p>`;
      return;
    }

    filteredArticles.forEach(article => {
      // 기사의 전체 배열 내 진짜 ID(인덱스)를 찾아야 article.html에서 제대로 읽을 수 있음.
      const originalIndex = articles.findIndex(a => a.link === article.link);

      const labelText = isTheater ? '연극' : '영화';
      const cssClass = isTheater ? 'theater' : 'film';

      const el = document.createElement('article');
      el.className = 'article-card animate-in';

      const imageHtml = article.image
        ? `<div class="card-image-inner" style="background-image:url('${article.image}');"></div>`
        : `<div class="card-image-inner placeholder-${cssClass}"></div>`;

      // 카테고리에서는 요약을 짧게 보여주거나 글목록 형태
      const snippet = article.summary_kr && !article.summary_kr.startsWith('[번역 실패]')
        ? article.summary_kr.substring(0, 80) + '...'
        : '내용 보기';

      el.innerHTML = `
        <a href="article.html?id=${originalIndex}">
          <div class="card-image">
            ${imageHtml}
            <span class="card-category ${cssClass}">${labelText}</span>
          </div>
          <div class="card-body">
            <h3 class="card-title">${article.title_kr || article.title}</h3>
            <p class="card-excerpt">${snippet}</p>
            <div class="card-meta">
              <span>${formatKoreanDate(article.date).split(' ')[0] + ' ' + formatKoreanDate(article.date).split(' ')[1] + ' ' + formatKoreanDate(article.date).split(' ')[2]}</span>
              <span>1분 읽기</span>
            </div>
          </div>
        </a>
      `;
      container.appendChild(el);
    });

  } catch (err) {
    console.error('카테고리 데이터 불러오기 에러:', err);
    container.innerHTML = '<p style="grid-column: 1 / -1;">데이터를 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/* --- 테마 설정 및 토글 --- */
function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');
  if (!toggleBtn) return;

  // 1. 저장된 테마 불러오기 (없으면 시스템 설정 따름)
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateToggleIcon(savedTheme);
  } else {
    // 기본은 다크 모드 (태그 없음)
    // 만약 시스템이 라이트 모드라면 라이트 모드 적용? 
    // 기획상 기본이 다크이므로, 사용자가 명시적으로 바꾸지 않는 한 다크 유지
  }

  // 2. 버튼 클릭 이벤트
  toggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateToggleIcon(newTheme);
  });
}

function updateToggleIcon(theme) {
  const toggleBtn = document.getElementById('themeToggle');
  if (!toggleBtn) return;
  // 라이트 모드일 때 -> 달 아이콘 (다크로 갈 수 있음)
  // 다크 모드일 때 -> 해 아이콘 (라이트로 갈 수 있음)
  toggleBtn.textContent = theme === 'light' ? '🌙' : '☀️';
}

/* --- 모바일 메뉴 토글 --- */
function initMobileMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (!toggle || !navLinks) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    navLinks.classList.toggle('open');
    document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
  });

  // 메뉴 링크 클릭 시 자동 닫기
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('active');
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}

/* --- 스크롤 시 헤더 배경 강화 --- */
function initHeaderScroll() {
  const header = document.querySelector('.header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('header-scrolled');
    } else {
      header.classList.remove('header-scrolled');
    }
  });
}

/* --- 스크롤 등장 애니메이션 --- */
function initScrollAnimations() {
  const elements = document.querySelectorAll('.animate-in');
  if (elements.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  elements.forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
}
