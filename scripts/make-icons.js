// Regenerates the two PWA icons (192px, 512px): a money-bag emoji centered
// on a rounded green square. Needs a Chromium install with a color-emoji
// font available (e.g. Noto Color Emoji on Linux) - this is a one-off dev
// tool, not part of the build or deploy pipeline, so that dependency never
// touches users or CI.
//
// Usage: npm install
//        npx playwright install chromium   (once, if not already installed)
//        npm run icons
const { chromium } = require('playwright');
const path = require('path');

const BG = '#0d5c3a';
const EMOJI = '💰';
const SIZES = [
  { px: 192, radius: 42, fontSize: 112, out: 'public/icons/icon-192.png' },
  { px: 512, radius: 112, fontSize: 300, out: 'public/icons/icon-512.png' }
];

function html({ px, radius, fontSize }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    .icon{width:${px}px;height:${px}px;border-radius:${radius}px;background:${BG};
      display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;line-height:1;}
  </style></head><body><div class="icon">${EMOJI}</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const spec of SIZES) {
    const page = await browser.newPage({ viewport: { width: spec.px, height: spec.px } });
    await page.setContent(html(spec));
    const el = await page.$('.icon');
    const out = path.join(__dirname, '..', spec.out);
    await el.screenshot({ path: out });
    console.log(`wrote ${spec.out}`);
    await page.close();
  }
  await browser.close();
})();
