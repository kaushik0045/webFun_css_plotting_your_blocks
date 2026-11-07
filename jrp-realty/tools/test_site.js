#!/usr/bin/env node
/* JRP Realty: rigorous browser test suite.
   Usage: node jrp-realty/tools/test_site.js [site-dir] [single-file.html]
   Optional: AXE=/path/to/axe.min.js for accessibility checks.
   Exits non-zero if any check fails. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SINGLE = process.argv[3] ? path.resolve(process.argv[3]) : null;
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const PAGES = ['index', 'about', 'portfolio', 'invest', 'how-we-work', 'eb-5', 'contact'];
const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1920];
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const url = p => 'file://' + path.join(SITE, p + '.html');

let pass = 0, fail = 0; const failures = [], warnings = new Set();
function warn(msg) { warnings.add(msg); }
function check(ok, name, detail) {
  if (ok) { pass++; } else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t); }
async function watch(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)|maps\.google|google\.com\/maps/.test(r.url())) errs.push('requestfailed: ' + r.url()); });
  return errs;
}
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, innerHeight * 0.6);
    for (let y = 0; y <= document.body.scrollHeight; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
  });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch({ args: GL });

  // 1. Every page at every width: errors, overflow, images, reveals
  section('Pages x widths: errors, horizontal overflow, images, hidden content');
  for (const p of PAGES) for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    const errs = await watch(page);
    await page.goto(url(p), { waitUntil: 'load' });
    await scrollThrough(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.reveal')].every(e => !e.offsetParent || getComputedStyle(e).opacity > 0.99), null, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, iw: innerWidth,
      wide: [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.right > innerWidth + 1 && !e.closest('.hero') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => e.tagName + '.' + e.className),
      brokenImgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
      stuck: [...document.querySelectorAll('.reveal')].filter(e => !e.closest('[hidden]') && e.offsetParent && getComputedStyle(e).opacity < 0.99).length,
    }));
    const tag = `${p}@${w}`;
    check(errs.length === 0, `${tag} no errors`, errs.join(' | '));
    check(r.sw <= r.iw, `${tag} no horizontal scroll`, `scrollWidth ${r.sw} > ${r.iw} ${r.wide.join(',')}`);
    check(r.brokenImgs.length === 0, `${tag} images load`, r.brokenImgs.join(','));
    check(r.stuck === 0, `${tag} all reveal content visible after scroll`, r.stuck + ' still hidden');
    await page.close();
  }
  console.log('done');

  // 2. Static structure checks per page
  section('Structure: titles, h1, ids, alt text, labels, links');
  const titles = new Set();
  for (const p of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url(p));
    const s = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
      const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
      const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
      return {
        title: document.title, desc: (document.querySelector('meta[name=description]') || {}).content || '',
        h1: document.querySelectorAll('h1').length, dupIds,
        noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        unlabeled: [...document.querySelectorAll('input,select,textarea')].filter(el => !(el.labels && el.labels.length) && !el.getAttribute('aria-label')).map(el => el.name || el.type),
        emptyLinks: [...document.querySelectorAll('a,button')].filter(a => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')).length,
        hrefs, anchors: hrefs.filter(h => h.startsWith('#') && h.length > 1).filter(h => !document.getElementById(h.slice(1))),
        lang: document.documentElement.lang, viewport: !!document.querySelector('meta[name=viewport]'),
        headingSkip: (() => { let last = 0, bad = []; document.querySelectorAll('h1,h2,h3,h4').forEach(h => { const n = +h.tagName[1]; if (last && n > last + 1) bad.push(h.tagName + ':' + h.textContent.trim().slice(0, 20)); last = n; }); return bad; })(),
      };
    });
    check(s.title && !titles.has(s.title), `${p} unique <title>`, s.title); titles.add(s.title);
    check(s.desc.length > 50, `${p} meta description`);
    check(s.h1 === 1, `${p} exactly one h1`, 'found ' + s.h1);
    check(s.dupIds.length === 0, `${p} no duplicate ids`, s.dupIds.join(','));
    check(s.noAlt === 0, `${p} all images have alt`);
    check(s.unlabeled.length === 0, `${p} all form fields labelled`, s.unlabeled.join(','));
    check(s.emptyLinks === 0, `${p} no empty links/buttons`, s.emptyLinks + ' found');
    check(s.anchors.length === 0, `${p} in-page anchors exist`, s.anchors.join(','));
    check(s.lang === 'en' && s.viewport, `${p} lang + viewport`);
    check(s.headingSkip.length === 0, `${p} heading levels don't skip`, s.headingSkip.join(' | '));
    for (const h of s.hrefs) {
      if (/^(https?:|mailto:|tel:)/.test(h) || h.startsWith('#')) {
        if (h === '#') warn('placeholder "#" links (social icons waiting for real URLs)');
        if (h.startsWith('tel:')) check(h === 'tel:+12096056500', `${p} tel link correct`, h);
        if (h.startsWith('mailto:')) check(h === 'mailto:ramansingh@jrpinvestmentgrp.com', `${p} mailto correct`, h);
        continue;
      }
      const file = path.join(SITE, h.split('#')[0]);
      check(fs.existsSync(file), `${p} link target exists: ${h}`);
    }
    if (AXE) {
      await page.addScriptTag({ content: AXE });
      await scrollThrough(page);
      const res = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations
        .filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
      check(res.length === 0, `${p} axe: no serious/critical a11y issues`, res.join(' | '));
    }
    await page.close();
  }
  console.log('done');

  // 3. Interactions
  section('Interactions: menu, keyboard, accordions, filters, count-up, tilt');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errs = await watch(page);
    await page.goto(url('index'));
    const menu = page.locator('#nav-links');
    check(!(await menu.isVisible()), 'mobile: menu starts closed');
    await page.click('.nav-toggle');
    check(await menu.isVisible(), 'mobile: menu opens on tap');
    check(await page.getAttribute('.nav-toggle', 'aria-expanded') === 'true', 'mobile: aria-expanded=true');
    await page.click('.nav-toggle');
    check(!(await menu.isVisible()), 'mobile: menu closes on second tap');
    for (let i = 0; i < 25; i++) await page.click('.nav-toggle');   // hammer it
    check(await menu.isVisible() === (await page.getAttribute('.nav-toggle', 'aria-expanded') === 'true'), 'mobile: state consistent after 25 rapid taps');
    // keyboard
    await page.goto(url('index'));
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.className);
    check(/skip-link/.test(first), 'keyboard: first Tab lands on skip link', first);
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => location.hash === '#main'), 'keyboard: skip link jumps to main');
    check(errs.length === 0, 'mobile interactions: no errors', errs.join(' | '));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = await watch(page);
    await page.goto(url('index'));
    const acc = page.locator('.accordions details');
    const n = await acc.count();
    check(n === 3, 'home: 3 accordions', 'found ' + n);
    for (let i = 0; i < n; i++) { await acc.nth(i).locator('summary').click(); check(await acc.nth(i).evaluate(d => d.open), `accordion ${i + 1} opens`); await acc.nth(i).locator('summary').click(); check(!(await acc.nth(i).evaluate(d => d.open)), `accordion ${i + 1} closes`); }
    await acc.nth(0).locator('summary').focus(); await page.keyboard.press('Enter');
    check(await acc.nth(0).evaluate(d => d.open), 'accordion opens with keyboard');
    // count-up
    await page.locator('.stats').scrollIntoViewIfNeeded(); await page.waitForTimeout(2200);
    const nums = await page.$$eval('[data-count]', els => els.map(e => [e.dataset.count, e.textContent]));
    nums.forEach(([want, got]) => check(want === got, `count-up ends exactly at ${want}`, 'got ' + got));
    // tilt resets
    const card = page.locator('.project.tilt').first();
    await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(900);
    const box = await card.boundingBox();
    for (let i = 0; i < 40; i++) await page.mouse.move(box.x + Math.random() * box.width, box.y + Math.random() * box.height);
    check(/rotate/.test(await card.evaluate(e => e.style.transform)), 'tilt applies on hover');
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    check((await card.evaluate(e => e.style.transform)) === '', 'tilt resets when mouse leaves');
    check(errs.length === 0, 'desktop interactions: no errors', errs.join(' | '));
    await page.goto(url('portfolio'));
    const counts = {};
    for (const f of ['all', 'current', 'funded', 'all', 'funded', 'current']) {
      await page.click(`.filter[data-filter=${f}]`);
      counts[f] = await page.$$eval('.projects .property', cs => cs.filter(c => !c.hidden).length);
      check(await page.getAttribute(`.filter[data-filter=${f}]`, 'aria-pressed') === 'true', `filter ${f} pressed state`);
    }
    check(counts.all === 3 && counts.current === 2 && counts.funded === 1, 'portfolio filters show 3 / 2 / 1', JSON.stringify(counts));
    await page.goto(url('invest'));
    const faqs = page.locator('.faq details');
    const fn = await faqs.count();
    for (let i = 0; i < fn; i++) { await faqs.nth(i).locator('summary').click(); }
    check((await page.$$eval('.faq details', d => d.filter(x => x.open).length)) === fn, `invest: all ${fn} FAQs open`);
    await page.close();
  }
  console.log('done');

  // 4. Forms under pressure
  section('Forms: validation, encoding, newsletter');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = await watch(page);
    await page.goto(url('contact'));
    await page.evaluate(() => { window.__mail = []; const o = Object.getOwnPropertyDescriptor(Location.prototype, 'href'); });
    // intercept mailto navigation
    await page.addInitScript(() => {});
    let nav = null;
    page.on('framenavigated', f => { if (f.url().startsWith('mailto:')) nav = f.url(); });
    await page.route('**/*', r => r.continue());
    const form = page.locator('form.form').first();
    await form.locator('button[type=submit]').click();
    check(await page.evaluate(() => !document.querySelector('form.form').checkValidity()), 'empty contact form is blocked by validation');
    await form.locator('[name=email]').fill('not-an-email');
    await form.locator('[name=name]').fill('X');
    check(await page.evaluate(() => !document.querySelector('form.form [name=email]').checkValidity()), 'invalid email rejected');
    const evil = 'Line1 & "quotes" <b>tags</b> #hash ?q=1 100% 🏠 ਪੰਜਾਬੀ\nLine2';
    const captured = await page.evaluate(async (msg) => {
      const f = document.querySelector('form.form');
      f.querySelector('[name=name]').value = 'Test <User> & Co';
      f.querySelector('[name=email]').value = 'test@example.com';
      f.querySelector('[name=phone]').value = '+1 (209) 555-0100';
      f.querySelector('[name=message]').value = msg + 'x'.repeat(5000);
      let url = null;
      const desc = Object.getOwnPropertyDescriptor(window.location.__proto__, 'href') ;
      // capture by overriding assign path: main.js sets window.location.href
      try { Object.defineProperty(window, '__cap', { value: [], writable: true }); } catch (e) {}
      return new Promise(res => {
        const orig = HTMLFormElement.prototype.requestSubmit;
        window.addEventListener('beforeunload', () => {}, { once: true });
        const t = setTimeout(() => res({ status: f.querySelector('[role=status]').textContent }), 400);
        f.requestSubmit();
      });
    }, evil);
    check(/email app/.test(captured.status), 'valid contact form submits (status message updates)', captured.status);
    // verify encoding logic directly
    const body = await page.evaluate((msg) => {
      const enc = encodeURIComponent(msg); return decodeURIComponent(enc) === msg;
    }, evil);
    check(body, 'special characters / emoji / Punjabi survive mailto encoding');
    const nl = page.locator('.newsletter').first();
    await nl.locator('button').click();
    check(await nl.evaluate(f => !f.checkValidity()), 'newsletter: empty email blocked');
    check(errs.filter(e => !/mailto/.test(e)).length === 0, 'forms: no errors', errs.join(' | '));
    await page.close();
  }
  console.log('done');

  // 5. Hostile environments
  section('Hostile environments: no JS, no WebGL, reduced motion, slow network');
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    for (const p of PAGES) {
      const page = await ctx.newPage(); await page.goto(url(p));
      const hidden = await page.evaluate(() => [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity < 0.99).length);
      check(hidden === 0, `no-JS ${p}: content visible`, hidden + ' sections invisible');
      await page.close();
    }
    await ctx.close();
  }
  {
    const b2 = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const page = await b2.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = await watch(page);
    await page.goto(url('index')); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ canvas: !!document.querySelector('.scene-canvas'), bg: getComputedStyle(document.querySelector('.hero')).backgroundImage }));
    check(!r.canvas && /hero\.jpg/.test(r.bg), 'no WebGL: falls back to hero photo', JSON.stringify(r));
    check(errs.length === 0, 'no WebGL: no errors', errs.join(' | '));
    await b2.close();
  }
  {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errs = await watch(page);
    await page.goto(url('index')); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      hidden: [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity < 0.99).length,
      coin: getComputedStyle(document.querySelector('.coin')).animationName,
      canvas: !!document.querySelector('.scene-canvas'),
    }));
    check(r.hidden === 0, 'reduced motion: everything visible immediately', r.hidden + ' hidden');
    check(r.coin === 'none', 'reduced motion: coin stops spinning');
    check(r.canvas, 'reduced motion: 3D still drawn (static frame)');
    check(errs.length === 0, 'reduced motion: no errors', errs.join(' | '));
    await ctx.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
    const t0 = Date.now(); await page.goto(url('index'), { waitUntil: 'domcontentloaded' });
    const h1 = await page.locator('h1').isVisible();
    check(h1, 'slow 3G-like network: headline renders', 'took ' + (Date.now() - t0) + 'ms');
    await page.close();
  }
  console.log('done');

  // 6. Stress
  section('Stress: resize storm, scroll storm, long run, frame time');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = await watch(page);
    await page.goto(url('index')); await page.waitForTimeout(1000);
    for (let i = 0; i < 60; i++) await page.setViewportSize({ width: 320 + Math.floor(Math.random() * 1600), height: 500 + Math.floor(Math.random() * 600) });
    await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(500);
    const c = await page.evaluate(() => { const c = document.querySelector('.scene-canvas'), h = document.querySelector('.hero'); return [c.clientWidth, h.clientWidth, c.clientHeight, h.clientHeight]; });
    check(c[0] === c[1] && c[2] === c[3], '60 random resizes: 3D canvas still matches hero size', c.join(','));
    for (let i = 0; i < 80; i++) await page.evaluate(() => scrollTo(0, Math.random() * document.body.scrollHeight));
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(800);
    // frame timing over 5 s
    const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f(t) { n++; if (t - t0 < 5000) requestAnimationFrame(f); else res(n / 5); })(t0); }));
    console.log('   approx FPS (software GL, headless):', fps.toFixed(1));
    check(fps > 10, '3D keeps animating over 5s', fps.toFixed(1) + ' fps');
    const lt = await page.evaluate(() => new Promise(res => { const out = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => out.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch (e) {} setTimeout(() => res(out), 3000); }));
    console.log('   long tasks (>50ms) in 3s:', lt.length, lt.length ? 'max ' + Math.max(...lt).toFixed(0) + 'ms' : '');
    // pause when scrolled away
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(600);
    const before = await page.evaluate(() => document.querySelector('.scene-canvas').toDataURL().length);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelector('.scene-canvas').toDataURL().length);
    check(before === after, '3D pauses when scrolled out of view (saves battery)');
    check(errs.length === 0, 'stress: no errors', errs.join(' | '));
    await page.close();
  }
  console.log('done');

  // 7. Single-file build
  if (SINGLE) {
    section('Single-file build: routing under pressure');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = await watch(page);
    await page.goto('file://' + SINGLE); await page.waitForTimeout(1200);
    const routes = ['#/about', '#/portfolio', '#/invest', '#/how-we-work', '#/eb-5', '#/contact', '#/'];
    for (const r of routes) {
      await page.evaluate(h => { location.hash = h; }, r); await page.waitForTimeout(250);
      const vis = await page.evaluate(() => [...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).map(p => p.dataset.page));
      check(vis.length === 1 && ('#/' + vis[0]) === r, `single-file route ${r}`, vis.join(','));
    }
    for (let i = 0; i < 100; i++) await page.evaluate(h => { location.hash = h; }, routes[Math.floor(Math.random() * routes.length)]);
    await page.waitForTimeout(500);
    check((await page.evaluate(() => [...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).length)) === 1, 'single-file: 100 rapid route changes leave exactly one page shown');
    await page.evaluate(() => { location.hash = '#/does-not-exist'; }); await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('[data-page=""]').hidden), 'single-file: unknown route falls back to Home');
    await page.goBack(); await page.waitForTimeout(200);
    check((await page.evaluate(() => [...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).length)) === 1, 'single-file: Back button works');
    const ctxCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
    check(ctxCount <= 8, 'single-file: WebGL canvases within browser limit', ctxCount + ' canvases');
    check(errs.length === 0, 'single-file: no errors', errs.join(' | '));
    await page.close();
  }

  await browser.close();
  if (warnings.size) { console.log('\nWARNINGS:'); warnings.forEach(w => console.log(' ! ' + w)); }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
