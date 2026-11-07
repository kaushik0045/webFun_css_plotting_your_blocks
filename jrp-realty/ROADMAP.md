# JRP Realty website: roadmap

Ongoing project. Update this file at the end of every working session.

## Done
- [x] Collected all content from the old site (unravelersglobal.com/jrpinvestments), including hidden pages (EB-5, property details), logo, photos, testimonial
- [x] Studied the reference site, Bottom Line Group (Fresno); notes in REFERENCE.md
- [x] 7 pages: Home, About, Our Portfolio, Invest, How We Work, EB-5, Contact
- [x] Dark + JRP red theme (nothing like the Pacific Tax site)
- [x] Deep 3D hero (Three.js skyline, growth line, particles), 3D card tilt, count-up stats
- [x] Fast blur + zoom reveal (0.7s; was too slow at 2.4s and felt laggy)
- [x] Downloadables: all-in-one single HTML file + ZIP
- [x] Headline changed to "Invest in What LASTS"
- [x] Rigorous test suite (tools/test_site.js): 473 checks pass. Fixed: no-JS blank pages, red text contrast, fast-scroll hidden sections, heading order, WebGL error on unsupported browsers
  Run: `AXE=<path to axe.min.js> node jrp-realty/tools/test_site.js jrp-realty <single-file.html>`

## Next up: speed for hosting (decided: host as SEPARATE files, not the single file)
- [ ] Convert photos to WebP (keep JPG fallback)
- [ ] Phone-sized photo versions (srcset)
- [ ] Load the 3D library after the page's text appears
- [ ] Lighter 3D on phones / low-power devices (fewer particles, lower resolution); software rendering showed long main-thread tasks
- [ ] Pick a host: Netlify / Cloudflare Pages / GitHub Pages
- [ ] Custom domain (e.g. jrpinvestmentgrp.com or jrprealtygrp.com), ask the client which

## Waiting on the client
- [ ] Raman Singh's real title (currently "Investor Relations")
- [ ] Other team members: names, titles, photos
- [ ] Social media links (icons currently point to #)
- [ ] More projects / brands / real portfolio totals
- [ ] Which email to show: @jrpinvestmentgrp.com or @jrprealtygrp.com

## Ideas
- [ ] Contact form that sends directly (Formspree / Netlify Forms) instead of opening the email app
- [ ] 3D map of property locations (Manteca, Sacramento)
- [ ] Individual pages per property with photo galleries
- [ ] Investor login / portal (later)
