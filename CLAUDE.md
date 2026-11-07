# Repo notes for Claude

- Active, long-running project: the **JRP Realty** website in `jrp-realty/`. The user works on it regularly.
- At the start of a session, read `jrp-realty/REFERENCE.md` (client facts + reference site notes) and `jrp-realty/ROADMAP.md` (what's done / next). Update ROADMAP.md before ending a session.
- **Always** use Bottom Line Group (Fresno, CA), https://www.bottom-line.com/, as the design/structure reference.
- The site must look nothing like the older Pacific Tax site at the repo root (navy + gold + serif). JRP theme: black + red #E10600, Space Grotesk + Poppins, 3D hero.

## How the site is built
- The HTML pages are GENERATED. Edit `jrp-realty/tools/build_pages.py`, then run:
  `python3 jrp-realty/tools/build_pages.py jrp-realty`
  Don't hand-edit the .html files: the next build overwrites them.
- `css/style.css`, `js/main.js`, `js/scene.js` (3D) are edited directly.
- `js/vendor/three.min.js` is Three.js r128 (MIT), vendored so there's no CDN dependency.
- Single-file download (all pages in one HTML, hash routing):
  `python3 jrp-realty/tools/build_single_file.py jrp-realty <output.html>`
- Preview: the private Artifact https://claude.ai/artifact/1oUVQin2yJKC7pSt3LRGvG (republish index.html + changed files to keep the same link).
- Reading other websites: use Playwright/Chromium (pre-installed); some sites reject curl. New hosts must be allowed in the session's environment network settings.

## Other
- The rest of the repo root (index.html, taxes.html, …) is the separate Pacific Tax and Insurance site. Don't touch it unless asked.
- Work branch: `claude/quirky-turing-s7h69u`.
- User preference: short answers with lettered options to choose from.
