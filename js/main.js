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
});
