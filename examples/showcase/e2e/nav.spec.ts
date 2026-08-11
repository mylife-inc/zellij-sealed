import { test, expect } from '@playwright/test';
import { openPanel } from './helpers';


/**
 * Covers the nav acceptance criteria in spec §11.2a: sticky behavior sitewide,
 * transparent-to-solid transition on the landing page, dropdown, mega panel,
 * anchor scroll offset, active-state highlighting, mobile drawer, theme toggle,
 * and the dismissible announcement bar.
 */

test.describe('sticky nav', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop nav only');

  test('is sticky sitewide and stays pinned while scrolling', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const header = page.locator('.zellij-header');
    await expect(header).toHaveCSS('position', 'sticky');

    await page.evaluate(() => window.scrollTo(0, 800));
    await expect(header).toBeInViewport();
  });

  test('starts transparent over the hero on a landing page and solidifies on scroll', async ({
    page,
  }) => {
    await page.goto('/');
    const header = page.locator('.zellij-header');

    await expect(header).toHaveAttribute('data-transparent-capable', 'true');
    await expect(header).toHaveAttribute('data-solid', 'false');

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(header).toHaveAttribute('data-solid', 'true');

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute('data-solid', 'false');
  });

  test('renders solid from the start on non-landing layouts', async ({ page }) => {
    // Both showcase screens are `landing`; the guide is the docs layout.
    await page.goto('/guide');
    const header = page.locator('.zellij-header');
    await expect(header).toHaveAttribute('data-transparent-capable', 'false');
    await expect(header).toHaveAttribute('data-solid', 'true');
  });
});

test.describe('dropdown and mega panel', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop nav only');

  test('opens a simple dropdown and navigates', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Shop' });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const dropdown = page.locator('.zellij-dropdown');
    await expect(dropdown.getByRole('link', { name: 'Trade in' })).toBeVisible();

    await dropdown.getByRole('link', { name: 'Compare models' }).click();
    await expect(page).toHaveURL(/\/lumen-3-pro#buy$/);
  });

  test('opens a mega panel with grouped, described links and icons', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore' }).click();

    const mega = page.locator('.zellij-mega-panel');
    await expect(mega).toBeVisible();
    await expect(mega.getByText('The product')).toBeVisible();
    await expect(mega.getByText('More', { exact: true })).toBeVisible();
    await expect(mega.getByText('Grade 5 titanium, twelve grams lighter.')).toBeVisible();
    // Icons resolve server-side; every leaf in this panel declares one.
    await expect(mega.locator('.zellij-mega-icon svg')).toHaveCount(4);
  });

  test('opens flush against the bar, with no gap to cross', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    const header = (await page.locator('.zellij-header').boundingBox())!;
    const panel = (await page.locator('.zellij-mega-panel').boundingBox())!;

    // Any positive gap is a dead zone the pointer would have to cross.
    const gap = panel.y - (header.y + header.height);
    expect(gap).toBeLessThanOrEqual(0);
    expect(gap).toBeGreaterThan(-4);
  });

  /**
   * The panel spans the full bar, so its links sit far from the trigger that
   * opened them and a pointer travelling to one crosses neighbouring triggers.
   * Without hover intent those hijack the menu and the panel vanishes mid-reach.
   */
  test('survives a slow diagonal reach into a far-side panel link', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    const link = page.locator('.zellij-mega-link').first();
    const target = (await link.boundingBox())!;
    await page.mouse.move(target.x + 40, target.y + 12, { steps: 30 });

    await expect(page.locator('.zellij-mega-panel')).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/lumen-3-pro#design$/);
  });

  test('a deliberate dwell on another trigger switches panels', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    await page.getByRole('button', { name: 'Shop' }).hover();
    await expect(page.locator('.zellij-dropdown')).toBeVisible();
    await expect(page.locator('.zellij-mega-panel')).toBeHidden();
  });

  test('closes once the pointer leaves the header entirely', async ({ page }) => {
    await page.goto('/');
    await openPanel(page, 'Explore', '.zellij-mega-panel');

    await page.mouse.move(700, 600, { steps: 10 });
    await expect(page.locator('.zellij-mega-panel')).toBeHidden();
  });

  test('closes on Escape and returns focus to the trigger', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Explore' });
    await trigger.click();
    await expect(page.locator('.zellij-mega-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.zellij-mega-panel')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('opens with ArrowDown and moves focus into the panel', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Explore' });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');

    await expect(page.locator('.zellij-mega-panel')).toBeVisible();
    await expect(page.locator('.zellij-mega-panel a').first()).toBeFocused();
  });

  test('moves between top-level items with arrow keys', async ({ page }) => {
    await page.goto('/');
    // Scope to the main nav — the footer links share these labels.
    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await mainNav.getByRole('link', { name: 'Specs', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(mainNav.getByRole('link', { name: 'Guide', exact: true })).toBeFocused();
  });
});

test.describe('active state', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop nav only');

  test('marks the current page with aria-current', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    await expect(page.locator('.zellij-nav-link[aria-current="page"]')).toHaveText('Lumen 3 Pro');
  });

  test('keeps the parent item active on nested routes', async ({ page }) => {
    // `Explore` points at /guide; this route sits below it.
    await page.goto('/guide/quickstart');
    await expect(page.locator('.zellij-nav-trigger[data-active="true"]')).toContainText('Explore');
  });
});

test.describe('anchor links', () => {
  test('scroll to a section without hiding it behind the sticky bar', async ({ page }) => {
    await page.goto('/lumen-3-pro#design');

    const header = page.locator('.zellij-header');
    const headerBox = await header.boundingBox();
    const targetBox = await page.locator('#design').boundingBox();

    expect(headerBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    // The section must start below the bar, not underneath it.
    expect(targetBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 2);
  });
});

test.describe('announcement bar', () => {
  test('is dismissible and stays dismissed across navigations', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('.zellij-announcement');
    await expect(bar).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(bar).toBeHidden();

    await page.goto('/lumen-3-pro');
    await expect(page.locator('.zellij-announcement')).toBeHidden();
  });
});

test.describe('theme toggle', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop nav only');

  test('switches mode and persists the choice', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-zellij-mode', 'system');

    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await expect(html).not.toHaveAttribute('data-zellij-mode', 'system');

    const chosen = await html.getAttribute('data-zellij-mode');
    await page.goto('/lumen-3-pro');
    await expect(html).toHaveAttribute('data-zellij-mode', chosen!);
  });
});

test.describe('mobile drawer', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile viewport only');

  test('opens, locks scroll, expands nested items, and closes on Escape', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeVisible();

    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    // Nested items are accordions on mobile.
    const shop = drawer.getByRole('button', { name: 'Shop' });
    await expect(shop).toHaveAttribute('aria-expanded', 'false');
    await shop.click();
    await expect(shop).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('link', { name: /Trade in/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  /*
   * Escape, pressed straight after opening, with nothing else touched.
   *
   * The test above also presses Escape, and passed for years while this did
   * not: it clicks an accordion inside the drawer first, and in Chromium
   * clicking a button focuses it. The Escape handler was bound to the panel, so
   * that click was what let the keystroke reach it — open the drawer and press
   * Escape and nothing happened, in every browser.
   */
  test('closes on Escape without anything inside it being focused first', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();

    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(':focus')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  /*
   * `aria-modal="true"` tells assistive technology that everything outside the
   * dialog is inert. Nothing made that true: focus stayed on the hamburger, so
   * the next Tab went to the header and onward through the page behind it.
   */
  test('moves focus into the dialog on open', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();

    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toBeFocused();
  });

  /*
   * Closing puts focus back wherever it was, which is the trigger when the
   * trigger had it. On WebKit a tap focuses nothing, so there is nothing to
   * restore and the assertion would be about Safari's pointer model rather than
   * about the drawer. The keyboard path it protects — Enter on the button,
   * which does focus it — is Chromium's to demonstrate.
   */
  test('returns focus to the trigger on close', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari does not focus a button on tap');
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Open navigation' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('keeps Tab inside the drawer', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari does not Tab to links by default');
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();

    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeFocused();

    // Far more presses than the drawer has focusable children: if the trap
    // leaks, focus is somewhere in the page behind it well before this ends.
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');

    await expect(drawer.locator(':focus')).toHaveCount(1);
  });

  test('closes when the backdrop is tapped', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeVisible();

    await page.locator('.zellij-drawer-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(drawer).toBeHidden();
  });

  test('pins the CTA at the bottom of the drawer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.zellij-drawer-cta').getByRole('link', { name: 'Buy' })).toBeVisible();
  });
});

test.describe('accessibility', () => {
  test('exposes landmarks and a working skip link', async ({ page, browserName }) => {
    await page.goto('/');

    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.locator('main#content')).toHaveCount(1);

    const skip = page.locator('.zellij-skip-link');
    await expect(skip).toHaveAttribute('href', '#content');

    /*
     * The skip link must be the first thing keyboard users reach.
     *
     * Not asserted on WebKit, where it is a statement about the browser rather
     * than about the page: Safari ships with "Press Tab to highlight each item
     * on a webpage" off, so Tab moves between form controls and skips links
     * entirely. The skip link's markup and position are checked above on every
     * engine; only the keystroke is Chromium's to answer for.
     */
    test.skip(browserName === 'webkit', 'Safari does not Tab to links by default');
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
  });
});
