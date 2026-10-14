// Pacific Tax and Insurance — shared behavior

document.addEventListener('DOMContentLoaded', function () {
  var yearEls = document.querySelectorAll('[data-year]');
  yearEls.forEach(function (el) { el.textContent = new Date().getFullYear(); });

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
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
    el.textContent = message;
    el.classList.remove('success', 'error');
    el.classList.add(kind, 'is-visible');
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
