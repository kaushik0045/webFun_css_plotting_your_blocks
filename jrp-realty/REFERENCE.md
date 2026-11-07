# Project notes: JRP Realty website

## The client: JRP Realty / JRP Investment Group
- Current site: https://unravelersglobal.com/jrpinvestments/ (hosted on a third-party domain)
- Contact: Raman Singh, ramansingh@jrpinvestmentgrp.com, 209-605-6500
- Office: 1392 Mitchell Rd, Modesto, CA 95351
- Business: real estate syndication. JRP is the General Partner (finds, buys, manages); investors are passive Limited Partners.
- Pitch: for investors unhappy with savings/bond returns or stock-market swings. Promises: hands-off, stable income backed by leases, returns + tax benefits.
- Headline on old site: "Unlocking Tomorrow's Wealth". New site headline (chosen by user): "Invest in What LASTS" (LASTS in red)
- Brand: logo = red "JRP" + "INVESTMENT GROUP" (images/logo.png, logo-white.png). Old site colors: red #E80101, dark teal, deep blue; font Poppins.
- Alt email seen on EB-5 page: ramansingh@jrprealtygrp.com
- Portfolio (from detail pages):
  - Villa Ticinio Apartments: multifamily, 324 units, 2298 W. Louise Ave, Manteca CA 95337, current
  - Truck Stop & Plaza: 17.5 acres next to Sacramento Intl Airport, 2264 Meister Way, Sacramento CA 95835, current/upcoming
  - Best Western Plus: hotel, 101 rooms, off Freeway 99, 1415 Yosemite Ave, Manteca CA 95336, acquired 11/2022, funded
- Testimonial: Karandeep Brar ("Raman has holistic knowledge... bought 2 properties last year...")
- Hidden page: EB-5 Investment Program ($800K TEA / $1.05M non-TEA, 10 jobs).
- Old site can be read with headless Chromium (Playwright); plain curl gets 406.
- Old site problems: Lorem ipsum in process steps, empty testimonials, fake 2018 blog posts, dead links (Events, PortfolioNew), no disclaimer.
- Still needed from client: more team names/titles/photos, social links, Raman's real title, any extra projects or brands.

## THE REFERENCE SITE (always use this): Bottom Line Group, Fresno CA
- URL: https://www.bottom-line.com/
- Fresno, CA real estate development & investment firm (6781 N. Palm Ave Suite 100). President: Jay Virk.
- Tagline: "PLAN | DEVELOP | CONSULT". Hero: "Development is complex. We make it simple."
- Home page order: hero → welcome ("vertically integrated") → Mission / Vision / Values → Who We Are / What We Do / How We Do It → big stats row (25 developments, $230M+, 16 assets, $186M+) → portfolio preview (name + city) → "Trusted by premier brands" logos → team (photo, name, title) → contact form + newsletter.
- Portfolio page: headline total ($416M), tabs Current Assets / Current Developments / Investment Opportunities; each card = name + city; opportunities tagged *AVAILABLE* / *FILLED*.
- Invest page: 14 services, each with a headline, short paragraph, and 3 bullets.
- How We Do It: 7 numbered steps (Source → Feasibility → Entitlements → Land Development → Financing → Construction → Asset Management).
- About: firm story, Mission/Vision/Values, 4 numbered advantages.
- Weak spots to avoid: leftover Lorem ipsum/template pages, broken /connect page, no investor disclaimer.
- Look: black background, ONE bright accent (their green; we use JRP red), bold uppercase grotesk headings (Space Grotesk), full-width dark photo bands with translucent text panels, accordion Mission/Vision/Values, white stats strip, project photo grid, black brands panel, round team photos, accent-colored newsletter band.
- Use it for STRUCTURE and feel only. Never copy its text, logos, or images.

## Design rule
- Must look nothing like the Pacific Tax site in this repo (navy + gold + serif). Current JRP theme: black + red #E10600, Space Grotesk + Poppins.
