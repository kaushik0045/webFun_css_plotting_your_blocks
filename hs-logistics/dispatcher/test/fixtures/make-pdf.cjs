// Renders sample-ratecon.html to a PDF with the pre-installed Chromium.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'sample-ratecon.html'));
  await p.pdf({ path: path.join(__dirname, 'sample-ratecon.pdf'), format: 'Letter' });
  await b.close();
})();
