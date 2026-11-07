#!/usr/bin/env python3
"""JRP Realty page generator (dark/red theme, structure modeled on Bottom Line Group). Usage: python3 tools/build_pages.py <site-dir>"""
import pathlib, sys
OUT = pathlib.Path(sys.argv[1])

BRAND = "JRP Realty"
LEGAL = "JRP Investment Group"
EMAIL = "ramansingh@jrpinvestmentgrp.com"
PHONE = "209-605-6500"; TEL = "+12096056500"
ADDR = "1392 Mitchell Rd, Modesto, CA 95351"
MAPQ = "1392+Mitchell+Rd,+Modesto,+CA+95351"

SVG = {
 "mail": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
 "phone": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z"/></svg>',
 "pin": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
 "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
 "linkedin": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM7.1 20.5H3.5V9h3.6v11.5z"/></svg>',
 "facebook": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/></svg>',
 "instagram": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
}

NAV = [("index.html","Home"),("about.html","About Us"),("portfolio.html","Our Portfolio"),
       ("invest.html","Invest"),("how-we-work.html","How We Work"),("eb-5.html","EB-5")]

def header(active):
    li = "\n".join(f'        <li><a href="{h}"{" aria-current=\"page\"" if h==active else ""}>{t}</a></li>' for h,t in NAV)
    cur = ' aria-current="page"' if active=="contact.html" else ""
    return f"""<a href="#main" class="skip-link">Skip to main content</a>
<header class="site-header">
  <div class="container nav">
    <a class="logo" href="index.html"><img src="images/logo-white.png" alt="{BRAND}: JRP Investment Group" width="175" height="34"></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu">{SVG["menu"]}</button>
    <ul class="nav-links" id="nav-links">
{li}
      <li><a class="nav-cta" href="contact.html"{cur}>Contact</a></li>
    </ul>
  </div>
</header>"""

FOOTER = f"""<div class="news-wrap">
  <div class="container">
    <div class="news">
      <h3>Stay up to date &amp; connected</h3>
      <form class="newsletter" aria-label="Join investor updates">
        <input type="email" required placeholder="Enter your email" aria-label="Email address">
        <button type="submit">Subscribe Now</button>
      </form>
    </div>
  </div>
</div>
<footer class="site-footer">
  <div class="container">
    <div class="foot-top">
      <ul class="foot-links">
        <li><a href="index.html">Home</a></li><li><a href="about.html">About Us</a></li><li><a href="portfolio.html">Our Portfolio</a></li>
        <li><a href="invest.html">Invest</a></li><li><a href="eb-5.html">EB-5</a></li><li><a href="contact.html">Contact</a></li>
      </ul>
      <!-- SOCIAL: replace # with JRP's real profile URLs, or delete unused icons -->
      <div class="social"><a href="#" aria-label="Facebook">{SVG["facebook"]}</a><a href="#" aria-label="Instagram">{SVG["instagram"]}</a><a href="#" aria-label="LinkedIn">{SVG["linkedin"]}</a></div>
    </div>
    <p class="disclaimer">This website is for informational purposes only and is not an offer to sell, or a solicitation of an offer to buy, any security. Any offer will be made only through official offering documents to qualified investors where permitted by law. Real estate investing involves risk, including possible loss of principal. Past performance does not guarantee future results. EB-5 information is general and is not legal or immigration advice; consult a licensed immigration attorney. Consult your own tax, legal, and financial advisors before investing.</p>
    <div class="foot-bottom">
      <span>&copy; <span id="year">2026</span> {BRAND} | {LEGAL}. All rights reserved.</span>
      <span><a href="tel:{TEL}">{PHONE}</a> &nbsp;·&nbsp; <a href="mailto:{EMAIL}">{EMAIL}</a></span>
    </div>
  </div>
</footer>
<script src="js/vendor/three.min.js" defer></script>
<script src="js/scene.js" defer></script>
<script src="js/main.js"></script>"""

def page(fn, title, desc, body):
    (OUT/fn).write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="images/hero.jpg">
<script>document.documentElement.classList.add("js")</script>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
{header(fn)}
<main id="main">
{body.strip()}
</main>
{FOOTER}
</body>
</html>
""")

def hero_page(img, kicker, h1, lead):
    return f"""<section class="hero hero--page" data-scene="mini" style="background-image:url('images/{img}')">
  <div class="container">
    <p class="small-upper">{kicker}</p>
    <h1>{h1}</h1>
    <p class="lead">{lead}</p>
  </div>
</section>"""

# ---------- data ----------
PROJECTS = [
 dict(name="Villa Ticinio Apartments", city="Manteca, California", img="villa-ticinio-2.jpg", cat="current", badge="Current Project",
      facts=[("Property type","Multifamily"),("Size","324 units"),("Address","2298 W. Louise Ave, Manteca, CA 95337")],
      desc="An ongoing investment in 324 multifamily apartment homes in Manteca: every door is an opportunity for growth."),
 dict(name="Truck Stop &amp; Plaza", city="Sacramento, California", img="truck-stop-2.jpg", cat="current", badge="Current Project",
      facts=[("Property type","Truck stop &amp; plaza"),("Size","17.5 acres"),("Address","2264 Meister Way, Sacramento, CA 95835")],
      desc="An upcoming truck stop and plaza on 17.5 acres right next to Sacramento International Airport."),
 dict(name="Best Western Plus", city="Manteca, California", img="best-western-plus.jpg", cat="funded", badge="Funded",
      facts=[("Property type","Hotel"),("Size","101 rooms"),("Acquired","November 2022"),("Address","1415 Yosemite Ave, Manteca, CA 95336")],
      desc="A fully funded 101-room hotel just off Freeway 99, backed by our investors."),
]

def proj(p, detail=False):
    extra = ""
    if detail:
        extra = '<ul class="facts">' + "".join(f"<li><span>{k}</span><b>{v}</b></li>" for k,v in p["facts"]) + f'</ul><p class="desc">{p["desc"]}</p>'
    return f"""<article class="project property reveal tilt" data-cat="{p["cat"]}">
        <div class="ph"><img src="images/{p["img"]}" alt="{p["name"]}, {p["city"]}" loading="lazy"><span class="badge{" badge--funded" if p["cat"]=="funded" else ""}">{p["badge"]}</span></div>
        <h3>{p["name"]}</h3>
        <div class="loc">{p["city"]}</div>{extra}
      </article>"""

ACCORDIONS = f"""<div class="accordions reveal">
      <details>
        <summary>Our Mission</summary>
        <div class="acc-body"><p>Our mission is to deliver steady, passive income and long-term growth to our investors through carefully selected real estate, with all the work and none of the stress on their side.</p>
        <p>We get there through careful underwriting, disciplined planning, and hands-on management of every property we own.</p></div>
      </details>
      <details>
        <summary>Our Vision</summary>
        <div class="acc-body"><p class="quote">&ldquo;The Central Valley&rsquo;s most trusted real estate investment partner.&rdquo;</p>
        <p>We aim to be the first call for investors, sellers, and communities in California&rsquo;s Central Valley by delivering value, integrity, and results on every project.</p></div>
      </details>
      <details>
        <summary>Our Values</summary>
        <div class="acc-body"><p class="values">TRANSPARENCY &nbsp;|&nbsp; INTEGRITY &nbsp;|&nbsp; STABILITY &nbsp;|&nbsp; PARTNERSHIP &nbsp;|&nbsp; DISCIPLINE</p>
        <p>We treat every investor dollar as our own, report openly, and only pursue deals we would invest in ourselves.</p></div>
      </details>
    </div>"""

TEAM = f"""<section class="team-band" style="background-image:url('images/hero.jpg')">
  <div class="container">
    <div class="section-title"><h2>Our <span>Team</span></h2><p>Driven by purpose, committed to our investors.</p></div>
    <!-- TEAM: add more members (photo in images/, name, title). -->
    <div class="team">
      <div class="member reveal tilt" data-tilt="14"><div class="pic"><img src="images/raman-singh.jpg" alt="Raman Singh"></div><h3>Raman Singh</h3><p>Investor Relations</p><a href="mailto:{EMAIL}">Email Raman</a></div>
      <div class="member member--empty reveal"><div class="pic">+</div><h3>Team Member</h3><p>Title</p></div>
      <div class="member member--empty reveal"><div class="pic">+</div><h3>Team Member</h3><p>Title</p></div>
    </div>
  </div>
</section>"""

CONTACT_FORM = """<form class="form" id="contact-form">
        <div class="form-row">
          <div><label for="name">Name</label><input id="name" name="name" autocomplete="name" placeholder="Enter your name" required></div>
          <div><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="Phone number"></div>
        </div>
        <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="Enter your email" required></div>
        <div class="form-row">
          <div><label for="topic">Interested in</label><select id="topic" name="topic"><option>Investing with JRP</option><option>Current opportunities</option><option>EB-5 program</option><option>Selling a property</option><option>Something else</option></select></div>
          <div><label for="accredited">Accredited investor?</label><select id="accredited" name="accredited"><option>Not sure</option><option>Yes</option><option>No</option></select></div>
        </div>
        <div><label for="message">Message</label><textarea id="message" name="message" placeholder="Enter your message"></textarea></div>
        <button class="btn" type="submit">Submit Form</button>
        <p class="form-note" id="form-status" role="status">Submitting opens your email app with your message ready to send.</p>
      </form>"""

def contact_block(map_=False):
    m = f'<iframe class="map" title="Map to the {BRAND} office" loading="lazy" src="https://maps.google.com/maps?q={MAPQ}&output=embed"></iframe>' if map_ else ""
    return f"""<section class="contact-band" id="contact" style="background-image:url('images/villa-ticinio-1.jpg')">
  <div class="container split">
    <div class="reveal">
      <h2>Contact Us</h2>
      <p style="color:#ddd">Great things in business are never done by one person. They&rsquo;re done by a team of people.</p>
      <a class="c-item" href="mailto:{EMAIL}"><span class="ic">{SVG["mail"]}</span><span>{EMAIL}</span></a>
      <a class="c-item" href="tel:{TEL}"><span class="ic">{SVG["phone"]}</span><span>{PHONE}</span></a>
      <a class="c-item" href="https://maps.google.com/?q={MAPQ}" target="_blank" rel="noopener"><span class="ic">{SVG["pin"]}</span><span>{ADDR}</span></a>
      {m}
    </div>
    <div class="reveal">{CONTACT_FORM}</div>
  </div>
</section>"""

TESTIMONIAL = """<section class="section section--ink">
  <div class="container testimonial reveal">
    <p class="small-upper" style="margin-bottom:22px">What our clients say</p>
    <blockquote>Raman has holistic knowledge in commercial real estate, business, project investments and much more. His knowledge and patience has been a great tool in navigating intrinsic values within real estate markets and acquiring them. We bought 2 properties last year with Raman as our representation. I highly recommend him and his team. Thank you!!</blockquote>
    <cite>Karandeep Brar</cite>
  </div>
</section>"""

# ================= HOME =================
page("index.html", f"{BRAND} | Real Estate Investments, Modesto CA",
 f"{BRAND} (JRP Investment Group) turns quality real estate into passive income for investors. Multifamily, hospitality and commercial projects across California.",
 f"""
<section class="hero" data-scene="full" style="background-image:url('images/hero.jpg')">
  <div class="container">
    <div class="emblem" aria-hidden="true"><div class="coin"><span><span><b>J</b>RP</span></span><span class="back">REALTY</span></div></div>
    <p class="tagline">INVEST<i>|</i>DEVELOP<i>|</i>GROW</p>
    <h1>Invest in What <span class="red">Lasts</span></h1>
    <p class="lead">Join the future of smart real estate investing. We find, fund, and manage the properties. You earn the passive income.</p>
    <div class="hero-actions"><a class="btn" href="contact.html">Become an Investor</a><a class="btn btn--ghost" href="portfolio.html">View Portfolio</a></div>
  </div>
  <span class="scroll-cue" aria-hidden="true"></span>
</section>

<section class="statement">
  <div class="container"><h2>Investing is complex</h2><p>We make it simple</p></div>
</section>

<section class="section">
  <div class="container">
    <div class="welcome reveal">
      <h2>Welcome to {BRAND}</h2>
      <p>Your partner for hands-off real estate investing.</p>
      <p>Based in <strong>Modesto, California</strong>, {LEGAL} works with investors tired of low returns from savings and bonds, or uneasy about stock market swings.</p>
      <p><strong>We use a syndication model:</strong> investors pool their capital and we handle everything, from sourcing and acquiring to managing and improving multifamily, hospitality, and commercial properties.</p>
    </div>
    {ACCORDIONS}
  </div>
</section>

<section class="photo-band" style="background-image:url('images/villa-ticinio-1.jpg')">
  <div class="container"><div class="panel reveal tilt" data-tilt="6">
    <h2>Who We <b>Are</b></h2>
    <p>{LEGAL} is a California real estate investment firm. As the General Partner (Sponsor) we carry the detail and the responsibility of every deal, so our Limited Partner investors enjoy a truly hands-off income stream.</p>
    <a class="btn btn--ghost" href="about.html">About Us</a>
  </div></div>
</section>
<section class="photo-band" style="background-image:url('images/truck-stop-1.jpg')">
  <div class="container"><div class="panel reveal tilt" data-tilt="6">
    <h2>What We <b>Do</b></h2>
    <p>We acquire and manage income-producing real estate: apartment communities, hotels, and commercial projects. Returns are anchored in tenant leases and real operating businesses, governed by strict state and federal laws.</p>
    <a class="btn btn--ghost" href="invest.html">Investing With Us</a>
  </div></div>
</section>
<section class="photo-band" style="background-image:url('images/best-western-plus.jpg')">
  <div class="container"><div class="panel reveal tilt" data-tilt="6">
    <h2>How We Do <b>It</b></h2>
    <p>A disciplined seven-step process: source, underwrite, inspect, finance, acquire, improve, and exit, with clear reporting to investors at every stage, plus real tax advantages from owning real estate.</p>
    <a class="btn btn--ghost" href="how-we-work.html">Our Process</a>
  </div></div>
</section>

<section class="stats">
  <div class="container stats-row">
    <div class="stat"><strong data-count="3">3</strong><span>Projects in our portfolio</span></div>
    <div class="stat"><strong data-count="324">324</strong><span>Apartment units in development</span></div>
    <div class="stat"><strong data-count="101">101</strong><span>Hotel rooms funded</span></div>
    <div class="stat"><strong data-count="17.5">17.5</strong><span>Acres next to Sacramento Airport</span></div>
  </div>
</section>

<section class="photo-band" style="background-image:url('images/villa-ticinio-2.jpg')">
  <div class="container"><div class="panel reveal" style="background:transparent;border:0;backdrop-filter:none">
    <h2>Where strategy meets <b>real assets</b></h2>
    <p>Current projects, funded projects, and new opportunities. Your path to passive income may begin here.</p>
    <a class="btn btn--wide" href="portfolio.html" style="max-width:520px;margin:24px auto 0">Click here to view our portfolio</a>
  </div></div>
</section>

<section class="section section--light">
  <div class="container">
    <div class="projects">
      {"".join(proj(p) for p in PROJECTS)}
    </div>
  </div>
</section>

<section class="section section--light" style="padding-top:0">
  <div class="container">
    <div class="brands-panel reveal">
      <h2>Brands in our portfolio</h2>
      <!-- Add more partner/brand names or logos (with permission) as they join. -->
      <div class="brand-logos"><span>BEST WESTERN PLUS<small>Hotel · Manteca, CA</small></span></div>
    </div>
  </div>
</section>

{TESTIMONIAL}
{TEAM}
{contact_block()}
""")

# ================= ABOUT =================
ADV = [("Hands-Off for Investors","We manage every milestone (acquisition, financing, operations, reporting) so our Limited Partners enjoy truly passive income."),
       ("Income Backed by Real Leases","Returns come from tenant leases and operating businesses governed by state and federal law, not market speculation."),
       ("Diversified Across Asset Types","Apartments, hospitality, and commercial projects give our portfolio more than one source of income."),
       ("Real Tax Advantages","Real estate ownership offers depreciation and other benefits that can reduce taxes on your distributions.")]
page("about.html", f"About Us | {BRAND}", f"About {BRAND} and {LEGAL}, a Modesto, California real estate investment firm.",
 hero_page("hero.jpg","About Us",f"About <span class='red'>JRP</span>","A California real estate investment firm built on one idea: investors deserve the rewards of real estate without the headaches.") + f"""
<section class="section">
  <div class="container split">
    <div class="reveal">
      <p class="small-upper">Our Story</p>
      <h2>Rooted in California. <span>Focused on investors.</span></h2>
      <p>{BRAND} ({LEGAL}) gives investors access to the kind of real estate that used to be reserved for large institutions: apartment communities, hotels, and commercial projects across California.</p>
      <p>Many people love the stability of real estate but don&rsquo;t want to be landlords. Through syndication, investors pool their capital and we act as General Partner, sourcing, acquiring, managing, and eventually selling each property.</p>
      <p>From our office in Modesto, we focus on assets with durable demand and dependable cash flow.</p>
    </div>
    <div class="img-wrap reveal"><div class="img-frame"><img src="images/villa-ticinio-1.jpg" alt="Villa Ticinio Apartments, Manteca"></div></div>
  </div>
  <div class="container">{ACCORDIONS}</div>
</section>
<section class="section section--ink">
  <div class="container narrow">
    <div class="section-title"><h2>What sets us <span>apart</span></h2></div>
    <div class="steps">{"".join(f'<div class="step reveal"><span class="n">0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div></div>' for i,(t,d) in enumerate(ADV))}</div>
  </div>
</section>
{TESTIMONIAL}
{TEAM}
""")

# ================= PORTFOLIO =================
page("portfolio.html", f"Our Portfolio | {BRAND}",
 f"{BRAND} portfolio: Villa Ticinio Apartments (324 units, Manteca), a 17.5-acre truck stop in Sacramento, and the 101-room Best Western Plus in Manteca.",
 hero_page("villa-ticinio-2.jpg","Our Portfolio","Real assets. <span class='red'>Real income.</span>","Multifamily, hospitality, and commercial real estate across California's Central Valley and Sacramento region.") + f"""
<section class="section section--light">
  <div class="container">
    <div class="filters" role="group" aria-label="Filter projects">
      <button class="filter active" data-filter="all" aria-pressed="true">All</button>
      <button class="filter" data-filter="current" aria-pressed="false">Current Projects</button>
      <button class="filter" data-filter="funded" aria-pressed="false">Funded Projects</button>
    </div>
    <h2 class="sr-only">Projects</h2>
    <div class="projects" id="portfolio-grid">
      {"".join(proj(p, True) for p in PROJECTS)}
    </div>
  </div>
</section>
<section class="photo-band" style="background-image:url('images/truck-stop-2.jpg')">
  <div class="container"><div class="panel reveal tilt" data-tilt="6">
    <h2>Want the <b>next opportunity</b>?</h2>
    <p>Join our investor list and we&rsquo;ll reach out as soon as a new project opens.</p>
    <a class="btn" href="contact.html">Join the Investor List</a>
  </div></div>
</section>
""")

# ================= INVEST =================
SERV = [("Acquisitions","Finding the right properties","We source deals through brokers, owners, and our local network, focusing on assets with strong demand and room to grow.",["Market and location research","On- and off-market deals","Multifamily, hospitality, commercial"]),
 ("Due Diligence","Informed decisions, fewer surprises","Every property gets detailed financial, physical, and legal review before investor capital is committed.",["Conservative financial models","Inspections, title, and legal review","Clear risk assessment"]),
 ("Financing","Smart capital structure","We arrange debt on terms that protect cash flow and keep each investment on solid footing.",["Lender relationships","Rate and term planning","Reserves and contingencies"]),
 ("Development","From land to finished project","For ground-up projects like our Sacramento truck stop, we manage planning, approvals, and construction.",["Site planning and approvals","Contractor coordination","Budget and schedule control"]),
 ("Asset Management","Growing value every month","We oversee operations, leasing, renovations, and budgets to raise income and property value.",["Property manager oversight","Value-add improvements","Cost control"]),
 ("Investor Relations","You always know where you stand","Regular updates, distributions, and tax documents, with questions answered by a real person.",["Performance reports","Distribution tracking","Annual K-1 tax documents"])]
FAQ = [("What is a real estate syndication?","A partnership where investors pool money to buy and operate a commercial property together. The General Partner (JRP) manages everything; Limited Partners (investors) share in income and profits without day-to-day work."),
 ("Do I need to manage anything?","No. As a Limited Partner your role is passive. We handle acquisition, management, and reporting."),
 ("How do I earn money?","Typically through periodic distributions from the property&rsquo;s cash flow, plus a share of profits when it is refinanced or sold. Returns are not guaranteed."),
 ("What are the tax benefits?","Owners of real estate can often deduct depreciation, which may offset some taxable income from distributions. Ask your tax advisor about your situation."),
 ("Who can invest?","Eligibility depends on each offering and on securities rules. Some offerings are limited to accredited investors. Contact us to discuss current opportunities."),
 ("How long is my money invested?","Hold periods vary by property, often several years. Each offering&rsquo;s documents describe the expected timeline.")]
page("invest.html", f"Invest | {BRAND}", f"Why invest with {BRAND}: hands-off income, stability backed by leases, and real estate tax advantages.",
 hero_page("best-western-plus.jpg","Invest","Why invest with <span class='red'>JRP</span>?","Real estate syndications let you enjoy the benefits of property ownership without the hassle of managing it.") + f"""
<section class="section">
  <div class="container split">
    <div class="reveal">
      <p class="small-upper">Real Estate Syndications</p>
      <h2>A collective way to <span>build wealth</span></h2>
      <p>In a syndication, investors combine their funds to buy and operate commercial real estate. It&rsquo;s a hands-off way to enjoy the perks of property ownership without the work of managing it.</p>
      <p>Our core expertise is <strong style="color:#fff">multifamily real estate</strong>. Every opportunity we offer is evaluated for growth potential, profitability, and sustainability, and our team guides both first-time and experienced investors.</p>
    </div>
    <div class="img-wrap reveal"><div class="img-frame"><img src="images/villa-ticinio-2.jpg" alt="Villa Ticinio Apartments rendering"></div></div>
  </div>
</section>
<section class="section section--ink">
  <div class="container">
    <div class="section-title"><h2>The <span>JRP</span> advantage</h2></div>
    <div class="services">
      <div class="service reveal tilt" data-tilt="8"><span class="num">GP</span><h3>General Partner</h3><p>As General Partner (&ldquo;Sponsor&rdquo;), JRP handles every detail of the syndication, from finding and acquiring assets to managing and improving them.</p></div>
      <div class="service reveal tilt" data-tilt="8"><span class="num">LP</span><h3>Limited Partner</h3><p>You invest capital and receive passive income and tax benefits, with no day-to-day responsibilities.</p></div>
      <div class="service reveal tilt" data-tilt="8"><span class="num">%</span><h3>Stability &amp; Rewards</h3><p>Income anchored in leases and real businesses, plus tax savings from depreciation and other benefits of ownership.</p></div>
    </div>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="section-title"><h2>What we <span>handle</span></h2><p>Our team manages the full life of every investment.</p></div>
    <div class="services">
      {"".join(f'<div class="service reveal tilt" data-tilt="8"><span class="num">0{i+1}</span><h3>{t}</h3><h4>{s}</h4><p>{d}</p><ul>' + "".join(f"<li>{b}</li>" for b in bl) + '</ul></div>' for i,(t,s,d,bl) in enumerate(SERV))}
    </div>
  </div>
</section>
<section class="section section--ink">
  <div class="container narrow">
    <div class="section-title"><h2>Common <span>questions</span></h2></div>
    <div class="faq reveal">{"".join(f"<details><summary>{q}</summary><div><p>{a}</p></div></details>" for q,a in FAQ)}</div>
  </div>
</section>
{contact_block()}
""")

# ================= HOW WE WORK =================
STEPS = [("Source","Find the right opportunity","We search for income-producing properties in markets with steady demand: apartments, hotels, and commercial land."),
 ("Underwrite","Run the numbers, then run them again","Rents, expenses, financing, and the local market are stress-tested. If it doesn&rsquo;t work on paper, we walk away."),
 ("Due Diligence","Inspect everything","Physical inspections, financial audits, title, and legal review, so there are no surprises after closing."),
 ("Raise &amp; Finance","Bring partners together","Investors join as Limited Partners and we secure financing on terms that protect cash flow."),
 ("Acquire","Close the deal","As General Partner, JRP closes on the property and starts the business plan on day one."),
 ("Manage &amp; Improve","Add value every month","We oversee operations, upgrades, and leasing, and send investors regular updates and distributions."),
 ("Exit","Return capital and profits","When the plan is complete, we refinance or sell and share the profits with our investors.")]
page("how-we-work.html", f"How We Work | {BRAND}", f"The {BRAND} seven-step investment process, from sourcing to exit.",
 hero_page("truck-stop-1.jpg","How We Work","Our <span class='red'>7-step</span> process","A disciplined, repeatable approach that protects investor capital from first look to final sale.") + f"""
<section class="section">
  <div class="container">
    <h2 class="sr-only">The seven steps</h2>
    <div class="steps">{"".join(f'<div class="step reveal"><span class="n">0{i+1}</span><div><h3><small>Step {i+1}: {t}</small>{h}</h3><p>{d}</p></div></div>' for i,(t,h,d) in enumerate(STEPS))}</div>
  </div>
</section>
<section class="section section--ink">
  <div class="container">
    <div class="section-title"><h2>Your part is <span>simple</span></h2></div>
    <div class="services">
      <div class="service reveal tilt" data-tilt="8"><span class="num">01</span><h3>Join Now</h3><p>Schedule a call, share your goals, and join our investor list to hear about new opportunities first.</p></div>
      <div class="service reveal tilt" data-tilt="8"><span class="num">02</span><h3>Invest</h3><p>Review the business plan and offering documents. When a deal fits, invest as a Limited Partner.</p></div>
      <div class="service reveal tilt" data-tilt="8"><span class="num">03</span><h3>Build Wealth</h3><p>Receive distributions and updates, enjoy the tax benefits, and share in the profits at sale.</p></div>
    </div>
  </div>
</section>
{contact_block()}
""")

# ================= EB-5 =================
EBFAQ = [("Who qualifies for the EB-5 program?","<p>The EB-5 program is designed for investors outside the United States who want to live, invest, and build wealth in the U.S.</p>"),
 ("How does the EB-5 investment work?","<p>USCIS reviews both the investment and the investor. The investment must be at least <strong>$800,000</strong> in a Targeted Employment Area (TEA) project or <strong>$1,050,000</strong> in a non-TEA project. It must come from lawful sources, stay invested through the I-829 petition, and create <strong>10 permanent full-time U.S. jobs</strong>.</p><p>Investors must also have a clean record, free of criminal convictions, immigration violations, and fraud.</p>"),
 ("Can my family come with me?","<p>Yes. Approved investors, their spouses, and unmarried children under 21 can relocate to the United States, in some cases in as little as two years.</p>"),
 ("What if my application is denied?","<p>Refiling and appeals are often possible. Consult your immigration attorney about the best course of action.</p>"),
 ("Which projects would I invest in?","<p>Contact our team to discuss current projects and whether they fit EB-5 requirements.</p>")]
page("eb-5.html", f"EB-5 Investment Program | {BRAND}", f"Learn how the EB-5 Immigrant Investor Program works and how {BRAND} can help guide international investors.",
 hero_page("hero.jpg","EB-5 Investment Program","Invest in the U.S. <span class='red'>Build your future here.</span>","The EB-5 Immigrant Investor Program offers a path to a U.S. green card through a qualifying investment.") + f"""
<section class="section">
  <div class="container split">
    <div class="reveal">
      <p class="small-upper">What is EB-5?</p>
      <h2>A path to <span>permanent residence</span></h2>
      <p>The EB-5 Immigrant Investor Program lets qualifying investors obtain U.S. permanent residence (a green card) by meeting the investment requirements set by U.S. Citizenship and Immigration Services (USCIS).</p>
      <p>{LEGAL} is ready to help guide you through the process. Call <a href="tel:{TEL}" style="color:#fff">{PHONE}</a> or email <a href="mailto:{EMAIL}" style="color:#fff">{EMAIL}</a> to explore opportunities.</p>
    </div>
    <div class="img-wrap reveal"><div class="img-frame"><img src="images/hero.jpg" alt="Modern residential building"></div></div>
  </div>
</section>
<section class="section section--ink">
  <div class="container">
    <div class="section-title"><h2>Key <span>numbers</span></h2></div>
    <div class="figures">
      <div class="figure reveal tilt"><strong><em>$</em>800K</strong><span>Minimum in a Targeted Employment Area (TEA)</span></div>
      <div class="figure reveal tilt"><strong><em>$</em>1.05M</strong><span>Minimum in a non-TEA project</span></div>
      <div class="figure reveal tilt"><strong>10</strong><span>Full-time U.S. jobs created</span></div>
    </div>
    <p class="note">Amounts reflect current USCIS requirements and can change. This page is general information, not legal or immigration advice. Always work with a licensed immigration attorney.</p>
  </div>
</section>
<section class="section">
  <div class="container narrow">
    <div class="section-title"><h2>Your <span>questions</span> answered</h2></div>
    <div class="faq reveal">{"".join(f"<details><summary>{q}</summary><div>{a}</div></details>" for q,a in EBFAQ)}</div>
  </div>
</section>
{contact_block()}
""")

# ================= CONTACT =================
page("contact.html", f"Contact Us | {BRAND}", f"Contact {BRAND} in Modesto, CA. Call {PHONE} or email {EMAIL}.",
 hero_page("villa-ticinio-1.jpg","Contact Us","Let&rsquo;s <span class='red'>talk</span>","Questions about investing, current projects, EB-5, or a property you&rsquo;d like to sell? We&rsquo;re here to help.") + contact_block(True))

print("built", sorted(p.name for p in OUT.glob("*.html")))
