(() => {
  // ヘッダーの影・ページトップボタン
  const header = document.querySelector('.header');
  const pageTop = document.querySelector('.page-top');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 10);
    if (pageTop) pageTop.classList.toggle('is-show', y > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // スマホメニュー
  const menuBtn = document.querySelector('.menu-btn');
  const gnav = document.querySelector('.gnav');
  const setMenu = (open) => {
    gnav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  };
  menuBtn.addEventListener('click', () => setMenu(!gnav.classList.contains('is-open')));
  gnav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // 施工実績フィルター
  const filterBtns = document.querySelectorAll('.works__filter button');
  const cards = document.querySelectorAll('.works__card');
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      const f = btn.dataset.filter;
      cards.forEach((c) => { c.hidden = f !== 'all' && c.dataset.cat !== f; });
    });
  });

  // 数字カウントアップ（HTMLには最終値を書いておき、検索エンジンにも正しい数字が伝わるようにする）
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / 1400, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeTargets = document.querySelectorAll(
    '.section-title, .reason__item, .service__card, .works__card, .voice__item, .flow__list li, .worries__list li, .values li'
  );

  if ('IntersectionObserver' in window && !reduce) {
    fadeTargets.forEach((el) => el.classList.add('js-fade'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    fadeTargets.forEach((el) => io.observe(el));

    const numIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countUp(e.target);
        numIo.unobserve(e.target);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-count]').forEach((el) => numIo.observe(el));
  }

  document.querySelectorAll('.js-year').forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
