/**
 * Crawls the built docs site and fails on any dead internal link or anchor.
 *
 *     node scripts/verify-links.mjs
 *
 * Zellij validates the links it owns — nav, footer, CTAs, sidebar entries — at
 * build time. It cannot validate links written inside MDX prose, and a docs
 * site is mostly prose. This closes that gap.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 4329;
const ORIGIN = `http://localhost:${PORT}`;

const server = spawn('npx', ['next', 'start', '--port', String(PORT)], { stdio: 'ignore' });
const problems = [];

try {
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  /** route → the pages that link to it, so a failure names the culprit. */
  const queue = [['/', '(entry)']];
  const visited = new Set();
  /** route → the anchor ids that page actually has. */
  const anchors = new Map();
  const wantedAnchors = [];

  while (queue.length > 0) {
    const [route, from] = queue.shift();
    if (visited.has(route)) continue;
    visited.add(route);

    const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    if (status >= 400) {
      problems.push(`${status} ${route}  ← linked from ${from}`);
      continue;
    }

    const { ids, links } = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('[id]')].map((el) => el.id),
      links: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
    }));

    anchors.set(route, new Set(ids));

    for (const href of links) {
      const [path, hash] = href.split('#');
      const target = path || route;
      if (!visited.has(target)) queue.push([target, route]);
      if (hash) wantedAnchors.push({ target, hash, from: route });
    }
  }

  // Anchors are checked after the crawl, so every target has been loaded.
  for (const { target, hash, from } of wantedAnchors) {
    const ids = anchors.get(target);
    if (!ids) {
      problems.push(`missing page for anchor ${target}#${hash}  ← linked from ${from}`);
    } else if (!ids.has(hash)) {
      problems.push(`no #${hash} on ${target}  ← linked from ${from}`);
    }
  }

  await browser.close();

  console.log(`Crawled ${visited.size} routes and ${wantedAnchors.length} anchor links.`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} broken link(s):`);
    for (const problem of [...new Set(problems)]) console.error(`  ✗ ${problem}`);
  } else {
    console.log('No broken links.');
  }
} finally {
  server.kill();
}

process.exit(problems.length > 0 ? 1 : 0);
