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
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('visible'); });
  }

  // Contact form: opens the visitor's email app with the message filled in.
  // (A static site can't send email by itself — swap for Formspree/Netlify Forms later if wanted.)
  var form = document.getElementById('contact-form');
  if (form) {
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
      var note = document.getElementById('form-status');
      if (note) note.textContent = 'Your email app should open with your message ready to send.';
    });
  }

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
  var filters = document.querySelectorAll('.filter');
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      filters.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      document.querySelectorAll('#portfolio-grid .property').forEach(function (card) {
        card.hidden = !(f === 'all' || card.getAttribute('data-cat') === f);
      });
    });
  });
})();
