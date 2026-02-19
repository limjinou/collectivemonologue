/* ============================================
   Collective Monologue — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initScrollAnimations();
  initHeaderScroll();
});

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
