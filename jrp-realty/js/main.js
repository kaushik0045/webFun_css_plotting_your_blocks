// JRP Investment Group — site scripts
(function () {
  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Footer year
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Fade-in on scroll
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: '0px 0px 8% 0px' });
    items.forEach(function (el) { io.observe(el); });
    // Safety net: on slow devices a fast flick can skip past a section before the
    // observer fires. Reveal everything that is above the bottom of the screen.
    var ticking = false;
    var sweep = function () {
      ticking = false;
      var limit = window.innerHeight * 1.1;
      items.forEach(function (el) {
        if (!el.classList.contains('visible') && el.offsetParent !== null && el.getBoundingClientRect().top < limit) { el.classList.add('visible'); io.unobserve(el); }
      });
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(sweep); } }, { passive: true });
    window.addEventListener('hashchange', function () { setTimeout(sweep, 50); });
    sweep();
  } else {
    items.forEach(function (el) { el.classList.add('visible'); });
  }

  // Contact form: opens the visitor's email app with the message filled in.
  // (A static site can't send email by itself — swap for Formspree/Netlify Forms later if wanted.)
  document.querySelectorAll('form.form').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var d = new FormData(form);
      var subject = 'JRP Realty inquiry: ' + (d.get('topic') || 'General') + ' — ' + (d.get('name') || '');
      var body =
        'Name: ' + (d.get('name') || '') + '\n' +
        'Email: ' + (d.get('email') || '') + '\n' +
        'Phone: ' + (d.get('phone') || '') + '\n' +
        'Interested in: ' + (d.get('topic') || '') + '\n' +
        'Accredited investor: ' + (d.get('accredited') || '') + '\n\n' +
        (d.get('message') || '');
      window.location.href = 'mailto:ramansingh@jrpinvestmentgrp.com' +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      var note = form.querySelector('[role="status"]');
      if (note) note.textContent = 'Your email app should open with your message ready to send.';
    });
  });

  // Newsletter: opens email app (static site)
  document.querySelectorAll('.newsletter').forEach(function (nf) {
    nf.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var em = nf.querySelector('input').value;
      window.location.href = 'mailto:ramansingh@jrpinvestmentgrp.com?subject=' +
        encodeURIComponent('Add me to the JRP Realty investor list') +
        '&body=' + encodeURIComponent('Please add ' + em + ' to your investor updates list.');
    });
  });

  // Portfolio filters
  document.querySelectorAll('.filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      var scope = btn.closest('.container') || document;
      scope.querySelectorAll('.filter').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      scope.querySelectorAll('.projects .property').forEach(function (card) {
        card.hidden = !(f === 'all' || card.getAttribute('data-cat') === f);
      });
    });
  });

  // 3D tilt on cards
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (fine && !calm) {
    document.querySelectorAll('.tilt').forEach(function (el) {
      var max = parseFloat(el.getAttribute('data-tilt') || '10');
      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        var x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
        el.style.transform = 'perspective(900px) rotateX(' + ((0.5 - y) * max) + 'deg) rotateY(' + ((x - 0.5) * max) + 'deg) translateZ(8px)';
        el.style.setProperty('--gx', (x * 100) + '%'); el.style.setProperty('--gy', (y * 100) + '%');
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  // Count-up numbers
  var nums = document.querySelectorAll('[data-count]');
  function run(el) {
    var end = parseFloat(el.getAttribute('data-count')), dec = (el.getAttribute('data-count').split('.')[1] || '').length;
    if (calm) { el.textContent = end.toFixed(dec); return; }
    var t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / 1600), v = end * (1 - Math.pow(1 - p, 3));
      el.textContent = v.toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { run(e.target); cio.unobserve(e.target); } }); }, { threshold: 0.6 });
    nums.forEach(function (n) { cio.observe(n); });
  }
})();
