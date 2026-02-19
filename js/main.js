/* ============================================
   Collective Monologue — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initMobileMenu();
  initScrollAnimations();
  initHeaderScroll();
  initTheme();
  loadArticles(); // 기사 불러오기 시작
});

/* --- 기사 데이터 로드 및 렌더링 --- */
async function loadArticles() {
  const grid = document.querySelector('.article-grid');
  // 홈 화면이 아니거나 그리드가 없으면 실행하지 않음 (기사 상세 페이지 등)
  if (!grid) return;

  try {
    const response = await fetch('data/articles.json');
    if (!response.ok) throw new Error('데이터 로드 실패');

    const articles = await response.json();

    // 기존 하드코딩된 기사들을 비우고 시작 (또는 로딩 스피너 대체)
    grid.innerHTML = '';

    articles.forEach(article => {
      const card = document.createElement('article');
      card.className = 'article-card animate-in';
      card.innerHTML = `
        <a href="article.html?id=${article.id}">
          <div class="card-image">
            <div class="card-image-inner ${article.image}"></div>
            <span class="card-category ${article.category}">${article.category === 'theater' ? '연극' : '영화'}</span>
          </div>
          <div class="card-body">
            <h3 class="card-title">${article.title}</h3>
            <p class="card-excerpt">${article.summary}</p>
            <div class="card-meta">
              <span>${article.date}</span>
              <span>${article.readTime} 읽기</span>
            </div>
          </div>
        </a>
      `;
      grid.appendChild(card);
    });

    // 새로 추가된 카드들에 애니메이션 적용을 위해 옵저버 재호출
    initScrollAnimations();

  } catch (error) {
    console.error('기사를 불러오는 중 오류 발생:', error);
    grid.innerHTML = '<p style="color:var(--color-text-muted); padding:2rem;">최신 뉴스를 불러오지 못했습니다.</p>';
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
      header.style.background = 'rgba(10, 10, 10, 0.98)';
      header.style.borderBottomColor = 'rgba(200,164,90,0.2)';
    } else {
      header.style.background = 'rgba(10, 10, 10, 0.92)';
      header.style.borderBottomColor = '';
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
