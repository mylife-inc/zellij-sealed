import { test, expect } from '@playwright/test';
import { openPanel } from './helpers';

/**
 * Covers the content model: the brand block, menu items resolved from
 * `menu.yaml`, and pages composed from named section files.
 */

test.describe('brand block', () => {
  test('renders the logo image and links it home', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const logo = page.locator('.zellij-brand .zellij-logo');
    await expect(logo).toHaveAttribute('href', '/');

    const image = logo.locator('.zellij-brand-image[data-variant="light"]');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('alt', 'Lumen');

    // The mark must actually load — a broken logo is invisible in a screenshot
    // because the alt text renders in roughly the same place.
    const loaded = await image.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
    expect(loaded).toBe(true);
  });

  test('goes home when clicked', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    await page.locator('.zellij-brand .zellij-logo').click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('menu', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'the desktop bar is hidden on mobile');

  test('lists the items declared in menu.yaml, in order', async ({ page }) => {
    await page.goto('/');

    const items = page.locator('.zellij-nav-desktop .zellij-nav-item');
    await expect(items).toHaveText(['Lumen 3 Pro', 'Shop', 'Explore', 'Specs', 'Guide']);
  });

  test('resolves a page reference to that page route', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Lumen 3 Pro', exact: true }).first().click();
    await expect(page).toHaveURL(/\/lumen-3-pro$/);
  });

  test('marks an external item and opens it in a new tab', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    const github = page.locator('.zellij-mega-link', { hasText: 'Source' });
    await expect(github).toBeVisible();
    await expect(github).toHaveAttribute('href', 'https://github.com/shebka/zellij');
    await expect(github).toHaveAttribute('target', '_blank');
    await expect(github).toHaveAttribute('rel', /noopener/);
    await expect(github.locator('.zellij-external-icon')).toBeVisible();
  });

  test('leaves an internal item routed in place', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    const about = page.locator('.zellij-mega-link', { hasText: 'Guide' });
    await expect(about).toHaveAttribute('href', '/guide');
    await expect(about).not.toHaveAttribute('target', '_blank');
  });

  test('follows a url item carrying an anchor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Specs' }).first().click();
    await expect(page).toHaveURL(/\/lumen-3-pro#specs$/);
  });
});

test.describe('pages composed from section files', () => {
  test('renders every referenced section in the declared order', async ({ page }) => {
    await page.goto('/');

    const types = await page
      .locator('[data-zellij-section]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-zellij-section')));

    expect(types).toEqual(['promo-grid', 'card-carousel']);
  });

  test('keeps the anchor ids the section files declare', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    for (const id of ['carriers', 'design', 'camera', 'specs', 'questions']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  /**
   * The landing page is built from promo tiles and a carousel, neither of which
   * renders an `<h1>`. Without a fallback it shipped with no top-level heading
   * at all — no document outline to navigate, and nothing for a crawler to read
   * as the page's title.
   */
  test('gives every page exactly one h1', async ({ page }) => {
    for (const route of ['/', '/lumen-3-pro', '/guide', '/guide/quickstart']) {
      await page.goto(route);
      await expect(page.locator('main h1')).toHaveCount(1);
    }
  });

  test('titles the landing page with its own title, not a section heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main h1')).toHaveText('Lumen');
  });

  test('resolves footer page references to routes', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('navigation', { name: 'Footer' });
    await expect(footer.getByRole('link', { name: 'Lumen 3 Pro' })).toHaveAttribute(
      'href',
      '/lumen-3-pro',
    );
    await expect(footer.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute(
      'href',
      '/guide',
    );
  });
});
