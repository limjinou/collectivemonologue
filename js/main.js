/* ============================================
   Collective Monologue — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initMobileMenu();
  initScrollAnimations();
  initHeaderScroll();
  initTheme();

  // 현재 페이지가 기사 상세 페이지인지 확인
  if (window.location.pathname.includes('article.html')) {
    renderSingleArticle();
  } else {
    loadArticles();
  }
});

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
              <span>${category}</span> · <span>${article.date}</span>
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
      <span>${article.date}</span>
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
