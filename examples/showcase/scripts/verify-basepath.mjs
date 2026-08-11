/**
 * Verifies the site works when reverse-proxied under a path prefix
 * (spec §11.5): links, images, fonts, and the search index must all resolve.
 *
 * Builds the demo with `basePath: '/products/acme/docs'`, serves it, asserts,
 * then restores the original configuration — including on failure.
 *
 *     node scripts/verify-basepath.mjs
 */
import { chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE_PATH = '/products/acme/docs';
const PORT = 4321;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const files = ['next.config.js', 'content/site.yaml'];
const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const restore = () => {
  for (const [file, content] of originals) writeFileSync(file, content);
};

let server;
const failures = [];
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

try {
  console.log(`Building with basePath ${BASE_PATH} …`);

  writeFileSync(
    'next.config.js',
    originals
      .get('next.config.js')
      .replace("// basePath: '/products/acme/docs',", `basePath: '${BASE_PATH}',`),
  );
  writeFileSync(
    'content/site.yaml',
    originals.get('content/site.yaml').replace('basePath: ""', `basePath: "${BASE_PATH}"`),
  );

  execSync('npx next build', { stdio: 'inherit' });

  server = spawn('npx', ['next', 'start', '--port', String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 7000));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

  const failed = [];
  page.on('response', async (r) => {
    if (r.status() >= 400) {
      const u = new URL(r.url());
      // Keep the query and the body: for /_next/image the optimizer explains
      // itself in the response, and the `url` param says what it was asked for.
      let body = '';
      try { body = (await r.text()).slice(0, 200); } catch {}
      failed.push(`${r.status()} ${u.pathname}${u.search ? `?${u.searchParams}` : ''}\n      ${body}`);
    }
  });

  console.log('\nLanding page:');
  const landing = await page.goto(`${ORIGIN}${BASE_PATH}`, { waitUntil: 'networkidle' });
  check('serves 200 under the prefix', landing?.status() === 200, String(landing?.status()));

  const navHref = await page
    .locator('.zellij-nav-link[href]')
    .first()
    .getAttribute('href');
  check('internal links carry the prefix', navHref?.startsWith(BASE_PATH), navHref ?? 'none');

  const imgSrc = await page.locator('[data-zellij-section="hero"] img').getAttribute('src');
  check('images carry the prefix', imgSrc?.startsWith(BASE_PATH), imgSrc ?? 'none');

  const fonts = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"], link[as="font"]')].map((l) => l.href),
  );
  check(
    'stylesheets/fonts carry the prefix',
    fonts.every((href) => new URL(href).pathname.startsWith(BASE_PATH)),
    fonts.map((f) => new URL(f).pathname).join(', ') || '(none)',
  );

  console.log('\nNavigation:');
  await page.locator('.zellij-nav-link[href]').first().click();
  await page.waitForLoadState('networkidle');
  check('in-site navigation stays under the prefix', page.url().includes(BASE_PATH), page.url());

  console.log('\nGuide and search:');
  const guide = await page.goto(`${ORIGIN}${BASE_PATH}/guide/quickstart`, {
    waitUntil: 'networkidle',
  });
  check('guide route resolves', guide?.status() === 200, String(guide?.status()));

  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1500);
  await page.locator('.zellij-search-input').fill('postgres');
  await page.waitForTimeout(800);
  const results = await page.locator('.zellij-search-result-title').allTextContents();
  check('search index loads and returns results', results.length > 0, results.join(', ') || 'none');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  check(
    'search navigation stays under the prefix',
    page.url().includes(`${BASE_PATH}/guide/`),
    page.url(),
  );

  console.log('\nSitemap:');
  const sitemap = await page.goto(`${ORIGIN}${BASE_PATH}/sitemap.xml`);
  check('sitemap resolves', sitemap?.status() === 200, String(sitemap?.status()));
  const xml = (await sitemap?.text()) ?? '';
  check('sitemap URLs carry the prefix', xml.includes(BASE_PATH));

  check('no 4xx/5xx responses during the run', failed.length === 0, failed.join(', '));

  await browser.close();
} finally {
  if (server) server.kill();
  restore();
  console.log('\nRestored original next.config.js and content/site.yaml.');
}

if (failures.length > 0) {
  console.error(`\nbasePath verification FAILED (${failures.length}): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nbasePath verification passed.');
