(() => {
  // ヘッダーの影
  const header = document.querySelector('.header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // スマホメニュー
  const menuBtn = document.querySelector('.menu-btn');
  const gnav = document.querySelector('.gnav');
  const setMenu = (open) => {
    gnav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setMenu(!gnav.classList.contains('is-open')));
  gnav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // 施工実績フィルター
  const filterBtns = document.querySelectorAll('.works__filter button');
  const cards = document.querySelectorAll('.works__card');
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      const f = btn.dataset.filter;
      cards.forEach((c) => c.classList.toggle('is-hidden', f !== 'all' && c.dataset.cat !== f));
    });
  });

  // 数字カウントアップ
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    const start = performance.now();
    const dur = 1400;
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // スクロールでフェードイン
  const fadeTargets = document.querySelectorAll(
    '.section-title, .reason__item, .service__card, .works__card, .voice__item, .flow__list li, .worries__list li'
  );
  fadeTargets.forEach((el) => el.classList.add('js-fade'));

  if ('IntersectionObserver' in window) {
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
  } else {
    fadeTargets.forEach((el) => el.classList.add('is-visible'));
    document.querySelectorAll('[data-count]').forEach((el) => (el.textContent = el.dataset.count));
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
