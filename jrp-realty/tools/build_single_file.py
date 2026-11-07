#!/usr/bin/env python3
"""Bundle all JRP Realty pages into ONE self-contained HTML file with hash routing (#/about etc.)."""
import sys, re, base64, pathlib
src, outfile = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
PAGES = [("index", ""), ("about", "about"), ("portfolio", "portfolio"), ("invest", "invest"),
         ("how-we-work", "how-we-work"), ("eb-5", "eb-5"), ("contact", "contact")]

def route(name): return "#/" if name == "index" else "#/" + name
def fix_links(h):
    # page.html (optionally with #frag) -> #/page
    return re.sub(r'href="([a-z0-9-]+)\.html(?:#[\w-]*)?"', lambda m: f'href="{route(m.group(1))}"', h)

home = (src / "index.html").read_text()
head = home[:home.index("<body>")]
header = home[home.index("<body>") + 6: home.index('<main id="main">')]
footer = home[home.index("</main>") + 7: home.index('<script src="js/vendor')]
header = header.replace(' aria-current="page"', "")

titles, mains = {}, []
for name, slug in PAGES:
    h = (src / f"{name}.html").read_text()
    titles[slug] = re.search(r"<title>(.*?)</title>", h).group(1)
    main = h[h.index('<main id="main">') + 16: h.index("</main>")]
    # make ids unique per page
    pre = (slug or "home") + "-"
    main = re.sub(r'\b(id|for|aria-controls)="([\w-]+)"', lambda m: f'{m.group(1)}="{pre}{m.group(2)}"', main)
    main = re.sub(r'href="#([\w-]+)"', lambda m: f'href="#{pre}{m.group(1)}"', main)
    hidden = "" if name == "index" else " hidden"
    mains.append(f'<div class="page" data-page="{slug}"{hidden}>\n{fix_links(main)}\n</div>')

header, footer = fix_links(header), fix_links(footer)
body = header + '<main id="main">\n' + "\n".join(mains) + "\n</main>" + footer

def data(rel):
    p = src / rel
    mime = {".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml"}[p.suffix.lower()]
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()

# Each photo is embedded once as a CSS variable / JS map, then referenced, to keep the file small.
imgs = sorted(set(re.findall(r"images/[\w.-]+\.(?:jpg|png)", body + head)))
img_vars = ":root{" + "".join(f"--img-{pathlib.Path(i).stem}:url('{data(i)}');" for i in imgs) + "}"
body = re.sub(r"url\('(images/[\w.-]+)'\)", lambda m: f"var(--img-{pathlib.Path(m.group(1)).stem})", body)
src_imgs = sorted(set(re.findall(r'src="(images/[\w.-]+)"', body)))
img_map = "{" + ",".join(f'"{i}":"{data(i)}"' for i in src_imgs) + "}"
body = re.sub(r'src="(images/[\w.-]+)"', lambda m: f'data-src="{m.group(1)}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="', body)

css = (src / "css/style.css").read_text()
head = head.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + img_vars + "\n" + css + "\n.page[hidden]{display:none!important}\n</style>")
head = head.replace('href="favicon.svg"', 'href="' + data("favicon.svg") + '"')
head = re.sub(r'<meta property="og:image"[^>]*>\n', "", head)

def js(rel): return (src / rel).read_text().replace("</script", "<\\/script")
router = """
(function () {
  var IMG = %s;
  document.querySelectorAll('img[data-src]').forEach(function (im) { im.src = IMG[im.getAttribute('data-src')]; });
  var TITLES = %s;
  var pages = document.querySelectorAll('[data-page]');
  var navLinks = document.querySelectorAll('.nav-links a, .foot-links a');
  function show() {
    var h = location.hash;
    if (h && h.indexOf('#/') !== 0) return;            // ordinary in-page anchor
    var slug = (h || '#/').slice(2).replace(/\\/$/, '');
    var target = document.querySelector('[data-page="' + slug + '"]') ? slug : '';
    pages.forEach(function (p) { p.hidden = p.getAttribute('data-page') !== target; });
    navLinks.forEach(function (a) {
      if (a.getAttribute('href') === '#/' + target) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITLES[target] || TITLES[''];
    var menu = document.getElementById('nav-links'); if (menu) menu.classList.remove('open');
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('resize'));
  }
  window.addEventListener('hashchange', show);
  show();
})();
""" % (img_map, __import__("json").dumps(titles))

scripts = ("<script>\n" + router + "\n</script>\n<script>\n" + js("js/vendor/three.min.js") + "\n</script>\n<script>\n" + js("js/scene.js") +
           "\n</script>\n<script>\n" + js("js/main.js") + "\n</script>\n")
out = head + "<body>" + body + scripts + "</body>\n</html>\n"
outfile.write_text(out)
left = re.findall(r'(?:src|href)="((?:css|js|images)/[^"]+|[a-z0-9-]+\.html)"', out)
print("bytes", len(out), "unresolved", left)
