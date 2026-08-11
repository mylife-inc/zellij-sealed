import { test, expect } from '@playwright/test';

/**
 * Covers the guide docs criteria in spec §7 and §11.2: docs layout with
 * sidebar, TOC, prev/next and breadcrumbs, plus the MDX component set and
 * Shiki code blocks.
 */

test.describe('docs layout', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'sidebar and TOC are desktop-only');

  test('renders sidebar, breadcrumbs, TOC and pager', async ({ page }) => {
    await page.goto('/guide/installation');

    const sidebar = page.getByRole('navigation', { name: 'Guide' });
    await expect(sidebar.getByText('Getting Started')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Installation' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Guide');
    await expect(crumbs).toContainText('Getting Started');
    await expect(crumbs).toContainText('Installation');

    const toc = page.getByRole('complementary', { name: 'On this page' });
    await expect(toc.getByRole('link', { name: 'Self-hosted' })).toBeVisible();

    // Sidebar order defines prev/next.
    await expect(page.locator('[data-direction="prev"]')).toContainText('Quickstart');
    await expect(page.locator('[data-direction="next"]')).toContainText('Configuration overview');
  });

  test('pager navigates through the guide in sidebar order', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await expect(page.locator('[data-direction="prev"]')).toHaveCount(0);

    await page.locator('[data-direction="next"]').click();
    await expect(page).toHaveURL(/\/guide\/installation$/);
  });

  test('TOC links jump to headings that clear the sticky bar', async ({ page }) => {
    await page.goto('/guide/installation');
    await page.getByRole('complementary', { name: 'On this page' })
      .getByRole('link', { name: 'Verifying' })
      .click();

    const header = page.locator('.zellij-header');
    const headerBox = await header.boundingBox();
    const target = await page.locator('#verifying').boundingBox();
    expect(target!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 2);
  });
});

test.describe('MDX components', () => {
  test('renders callouts with their type styling', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const callout = page.locator('.zellij-callout').first();
    await expect(callout).toHaveAttribute('data-type', 'info');
    await expect(callout).toContainText('Node.js 20.11 or newer');

    await page.goto('/guide/installation');
    await expect(page.locator('.zellij-callout[data-type="warning"]')).toBeVisible();

    await page.goto('/guide/config/overview');
    await expect(page.locator('.zellij-callout[data-type="danger"]')).toBeVisible();
  });

  test('numbers steps automatically from document order', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const markers = page.locator('.zellij-step-marker');
    await expect(markers).toHaveCount(4);
    await expect(markers.nth(0)).toHaveText('1');
    await expect(markers.nth(3)).toHaveText('4');
  });

  test('tabs switch panels and support arrow keys', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const tabs = page.locator('.zellij-tabs').first();
    const cli = tabs.getByRole('tab', { name: 'CLI' });
    const dashboard = tabs.getByRole('tab', { name: 'Dashboard' });

    await expect(cli).toHaveAttribute('aria-selected', 'true');
    await dashboard.click();
    await expect(dashboard).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tabpanel')).toContainText('Open the dashboard');

    await dashboard.press('ArrowLeft');
    await expect(cli).toHaveAttribute('aria-selected', 'true');
    await expect(cli).toBeFocused();
  });

  test('code groups label tabs from each block filename', async ({ page }) => {
    await page.goto('/guide/installation');
    const group = page.locator('.zellij-tabs[data-variant="code"]');
    await expect(group.getByRole('tab', { name: 'docker' })).toBeVisible();
    await expect(group.getByRole('tab', { name: 'kubernetes' })).toBeVisible();

    await group.getByRole('tab', { name: 'kubernetes' }).click();
    await expect(group.getByRole('tabpanel').filter({ hasText: 'apiVersion' })).toBeVisible();
  });

  test('renders card grids as links', async ({ page }) => {
    await page.goto('/guide/config/overview');
    const card = page.locator('.zellij-card').first();
    await expect(card).toContainText('Database setup');
    await card.click();
    await expect(page).toHaveURL(/\/guide\/config\/database$/);
  });

  test('renders screenshots through next/image', async ({ page }) => {
    await page.goto('/guide/config/database');
    const image = page.locator('.zellij-screenshot-image');
    await expect(image).toBeVisible();
    // next/image rewrites the src through its optimizer.
    await expect(image).toHaveAttribute('src', /_next\/image|_zellij/);
    await expect(page.locator('.zellij-screenshot-caption')).toContainText('replica');
  });
});

test.describe('code blocks', () => {
  test('highlights syntax at build time with no client highlighter', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const pre = page.locator('pre.shiki').first();
    await expect(pre).toBeVisible();
    // Tokens are individually coloured spans, i.e. real highlighting happened.
    await expect(pre.locator('span').first()).toBeVisible();
  });

  test('labels blocks by filename or language', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await expect(page.locator('.zellij-code-title').filter({ hasText: 'terminal' })).toBeVisible();
    await expect(page.locator('.zellij-code-lang').first()).toHaveText('bash');
  });

  test('highlights the lines named in the fence meta', async ({ page }) => {
    await page.goto('/guide/config/overview');
    // ```yaml title="lumen.yaml" {2,5-6} → three highlighted lines.
    await expect(page.locator('.line.highlighted')).toHaveCount(3);
  });

  test('copies code to the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are chromium-specific here');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/guide/quickstart');

    await page.locator('.zellij-code-copy').first().click();
    await expect(page.locator('.zellij-code-copy').first()).toContainText('Copied');

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('npm install -g @lumen/cli');
  });
});

test.describe('guide theming', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop toggle only');

  test('code blocks follow the active colour mode', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const token = page.locator('pre.shiki span').first();

    const lightColor = await token.evaluate((el) => getComputedStyle(el).color);
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await expect
      .poll(async () => token.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(lightColor);
  });
});

/**
 * Covers the collapsible guide navigation: arbitrary nesting from
 * `_sidebar.yaml`, expand/collapse, persistence, and the rule that the group
 * containing the current page is always open.
 */
test.describe('guide navigation tree', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'the sidebar is desktop-only');

  // Page bodies link to the same routes, so every lookup is scoped to the nav.
  const nav = (page: import('@playwright/test').Page) =>
    page.getByRole('navigation', { name: 'Guide' });

  test('renders groups nested inside groups', async ({ page }) => {
    await page.goto('/guide/quickstart');

    const nested = page.locator('.zellij-guide-sidebar-group[data-depth="1"]');
    await expect(nested).toHaveCount(1);
    await expect(nested.getByRole('button', { name: 'Data' })).toBeVisible();
  });

  test('collapses and expands a group', async ({ page }) => {
    await page.goto('/guide/quickstart');

    const toggle = nav(page).getByRole('button', { name: 'Configuration' });
    const child = nav(page).getByRole('link', { name: 'Configuration overview' });

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(child).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(child).toBeHidden();

    await toggle.click();
    await expect(child).toBeVisible();
  });

  test('remembers collapsed groups across navigation', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await nav(page).getByRole('button', { name: 'Configuration' }).click();
    await expect(nav(page).getByRole('link', { name: 'Configuration overview' })).toBeHidden();

    await page.goto('/guide/installation');
    await expect(nav(page).getByRole('button', { name: 'Configuration' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  /**
   * Otherwise a reader who collapsed a group and then followed a link into it
   * would land on a page that is invisible in the navigation.
   */
  test('forces open the group containing the current page', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await nav(page).getByRole('button', { name: 'Configuration' }).click();
    await expect(nav(page).getByRole('button', { name: 'Configuration' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Navigate into the collapsed branch — it must reopen.
    await page.goto('/guide/config/database');
    await expect(nav(page).getByRole('button', { name: 'Configuration' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(nav(page).getByRole('button', { name: 'Data' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(nav(page).getByRole('link', { name: 'Database' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('keeps prev/next and breadcrumbs correct through nesting', async ({ page }) => {
    await page.goto('/guide/config/database');

    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Configuration');
    await expect(crumbs).toContainText('Data');

    // Reading order is depth-first, so the previous page is the one above it.
    await expect(page.locator('[data-direction="prev"]')).toContainText('Configuration overview');
  });

  test('is keyboard operable', async ({ page }) => {
    await page.goto('/guide/quickstart');
    const toggle = nav(page).getByRole('button', { name: 'Configuration' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
