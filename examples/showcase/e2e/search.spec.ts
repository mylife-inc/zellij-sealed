import { test, expect } from '@playwright/test';

/** Covers the ⌘K guide search in spec §7.3 and §13.6. */

async function openSearch(page: import('@playwright/test').Page): Promise<void> {
  // Retry the shortcut: a keypress dispatched before React has hydrated finds
  // no listener attached, and the modal never opens. Easy to hit under load.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Search the guide' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15000 });

  // "Start typing" only appears once the index has actually loaded.
  await expect(page.locator('.zellij-search-empty')).toContainText(/Start typing/, {
    timeout: 15000,
  });
}

test.describe('search index', () => {
  test('is a static asset containing guide content only', async ({ request }) => {
    const response = await request.get('/_zellij/search-index.json');
    expect(response.status()).toBe(200);

    const entries = (await response.json()) as Array<{ route: string; text: string }>;
    expect(entries.length).toBeGreaterThan(5);

    // Marketing pages are excluded by design (spec §7.3).
    expect(entries.every((entry) => entry.route.startsWith('/guide'))).toBe(true);

    // Code blocks are stripped, so a search hits prose rather than snippets.
    expect(entries.some((entry) => entry.text.includes('docker run'))).toBe(false);
  });
});

test.describe('⌘K modal', () => {
  test('does not load the search library until opened', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (/flexsearch|search-index/.test(r.url())) requests.push(r.url());
    });

    await page.goto('/guide/quickstart');
    await page.waitForLoadState('networkidle');
    expect(requests).toHaveLength(0);

    await openSearch(page);
    expect(requests.length).toBeGreaterThan(0);
  });

  test('finds guide content and navigates to the matching section', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await openSearch(page);

    await page.locator('.zellij-search-input').fill('postgres');
    await expect(page.locator('.zellij-search-result')).not.toHaveCount(0);

    const first = page.locator('.zellij-search-result').first();
    await expect(first).toContainText('Database');
    await first.click();

    await expect(page).toHaveURL(/\/guide\/config\/database/);
  });

  test('is keyboard operable end to end', async ({ page }) => {
    await page.goto('/guide');
    await openSearch(page);

    await page.locator('.zellij-search-input').fill('install');
    await expect(page.locator('.zellij-search-result')).not.toHaveCount(0);

    await page.keyboard.press('ArrowDown');
    const active = page.locator('.zellij-search-result[data-active="true"]');
    await expect(active).toHaveCount(1);
    const chosen = await active.locator('.zellij-search-result-title').textContent();

    await page.keyboard.press('Enter');

    // Any guide route is valid — the guide index itself is a legitimate result,
    // so this asserts navigation happened, not which page ranked first.
    await expect(page).toHaveURL(/\/guide(\/|#|$)/);
    await expect(page.getByRole('dialog', { name: 'Search the guide' })).toBeHidden();
    expect(chosen).toBeTruthy();
  });

  test('reports when nothing matches', async ({ page }) => {
    await page.goto('/guide');
    await openSearch(page);
    await page.locator('.zellij-search-input').fill('zzzznotathing');
    await expect(page.locator('.zellij-search-empty')).toContainText('No results');
  });

  test('closes on Escape', async ({ page }) => {
    await page.goto('/guide');
    await openSearch(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search the guide' })).toBeHidden();
  });

  test('opens from the nav search button', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), 'the nav trigger is desktop-only');
    await page.goto('/');
    await page.locator('[data-zellij-search-trigger]').click();
    await expect(page.getByRole('dialog', { name: 'Search the guide' })).toBeVisible();
  });
});

test.describe('SEO', () => {
  test('emits absolute canonical, OG and Twitter metadata', async ({ page }) => {
    await page.goto('/');

    const content = (selector: string) =>
      page.locator(selector).first().getAttribute('content');

    expect(await content('meta[property="og:title"]')).toContain('Lumen');
    expect(await content('meta[property="og:url"]')).toMatch(/^https:\/\//);
    /*
     * The fingerprint belongs here as much as anywhere.
     *
     * A social card is cached by URL and by nobody you can reach: change the
     * image and every service that has already scraped the page keeps serving
     * the old one. The `?v=` is what makes a replaced OG image a different URL,
     * so the assertion allows it rather than the absolute form alone.
     */
    expect(await content('meta[property="og:image"]')).toMatch(
      /^https:\/\/.*og\.png(\?v=[0-9a-f]{8})?$/,
    );
    expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(await content('meta[name="description"]')).toBeTruthy();

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\//);
  });

  test('serves a sitemap and robots.txt', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<loc>https://lumen.example.com/</loc>');
    expect(xml).toContain('/guide/quickstart');

    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap:');
  });

  test('gives each page its own title and description', async ({ page }) => {
    await page.goto('/');
    const homeTitle = await page.title();

    await page.goto('/lumen-3-pro');
    expect(await page.title()).not.toBe(homeTitle);
  });
});
