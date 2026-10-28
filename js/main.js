// Pacific Tax and Insurance — shared behavior

document.addEventListener('DOMContentLoaded', function () {
  var yearEls = document.querySelectorAll('[data-year]');
  yearEls.forEach(function (el) { el.textContent = new Date().getFullYear(); });

  var progressBars = document.querySelectorAll('.scroll-progress');
  if (progressBars.length) {
    var updateProgress = function () {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      pct = Math.min(100, Math.max(0, pct));
      progressBars.forEach(function (bar) { bar.style.width = pct + '%'; });
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  var themeToggle = document.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = isDark ? 'light' : 'dark';
      if (next === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      try { localStorage.setItem('pti-theme', next); } catch (e) {}
    });
  }

  var forms = document.querySelectorAll('.lead-form');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var honeypot = form.querySelector('input[name="_gotcha"]');
      var status = form.querySelector('.form-status');
      var submitBtn = form.querySelector('.form-submit');

      if (honeypot && honeypot.value) {
        // Likely a bot: pretend success without submitting.
        showStatus(status, 'success', 'Thanks — we\'ll be in touch shortly.');
        form.reset();
        return;
      }

      if (submitBtn) { submitBtn.disabled = true; }

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      })
        .then(function (response) {
          if (response.ok) {
            showStatus(status, 'success', 'Thanks for reaching out — we\'ll follow up shortly by phone or email. Quotes are finalized by phone.');
            form.reset();
          } else {
            return response.json().then(function (data) {
              var message = data && data.errors
                ? data.errors.map(function (e) { return e.message; }).join(', ')
                : 'Something went wrong. Please call or WhatsApp us instead.';
              showStatus(status, 'error', message);
            });
          }
        })
        .catch(function () {
          showStatus(status, 'error', 'We could not send your message. Please call or WhatsApp us instead.');
        })
        .finally(function () {
          if (submitBtn) { submitBtn.disabled = false; }
        });
    });
  });

  function showStatus(el, kind, message) {
    if (!el) { return; }
    el.classList.remove('success', 'error');
    if (kind === 'success') {
      el.innerHTML = '<svg class="status-icon"><use href="#icon-check"></use></svg>' + message;
      el.classList.add('success', 'is-visible');
      var submitBtn = el.closest('form') ? el.closest('form').querySelector('.form-submit') : null;
      if (submitBtn) { burstConfetti(submitBtn); }
    } else {
      el.textContent = message;
      el.classList.add(kind, 'is-visible');
    }
  }

  function burstConfetti(anchorEl) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    var rect = anchorEl.getBoundingClientRect();
    var originX = rect.left + rect.width / 2;
    var originY = rect.top + rect.height / 2;
    var colors = ['#b8892e', '#d1a94f', '#274b83', '#25b357'];
    var container = document.createElement('div');
    container.className = 'confetti-burst';
    container.style.left = originX + 'px';
    container.style.top = originY + 'px';
    for (var i = 0; i < 18; i++) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      var angle = Math.random() * Math.PI * 2;
      var distance = 60 + Math.random() * 70;
      piece.style.setProperty('--dx', (Math.cos(angle) * distance) + 'px');
      piece.style.setProperty('--dy', (Math.sin(angle) * distance) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 360) + 'deg');
      piece.style.background = colors[i % colors.length];
      container.appendChild(piece);
    }
    document.body.appendChild(container);
    setTimeout(function () { container.remove(); }, 1000);
  }

  function blurIn(id) {
    var target = document.getElementById(id);
    if (!target) { return; }
    target.classList.remove('blur-in-target');
    void target.offsetWidth; // restart animation if triggered again
    target.classList.add('blur-in-target');
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    if (!id || !document.getElementById(id)) { return; }
    a.addEventListener('click', function (event) {
      event.preventDefault();
      history.pushState(null, '', '#' + id);
      document.getElementById(id).scrollIntoView({ behavior: 'auto', block: 'start' });
      blurIn(id);
    });
  });

  if (window.location.hash) {
    blurIn(window.location.hash.slice(1));
  }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateCount(el) {
    var target = parseInt(el.textContent, 10);
    if (isNaN(target)) { return; }
    if (reduceMotion) { el.textContent = target; return; }
    var duration = 1200;
    var startTime = null;
    function step(ts) {
      if (!startTime) { startTime = ts; }
      var progress = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.floor(target * progress);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target;
      }
    }
    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(function (el) { revealObserver.observe(el); });

    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('.count-up').forEach(function (el) { countObserver.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
  }
});
