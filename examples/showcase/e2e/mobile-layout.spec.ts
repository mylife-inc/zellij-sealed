import { expect, test } from '@playwright/test';

/**
 * Layout properties that only fail on a phone, and only away from the top of a
 * page.
 *
 * Every one of these is a bug that shipped. They were found by hand, on a real
 * iPhone, because the suite ran two Chromium projects and opened every overlay
 * at scroll position zero — the two conditions under which none of them
 * reproduce.
 */

/** Long enough to scroll, and present in the showcase content. */
const ROUTES = ['/', '/lumen-3-pro', '/guide', '/guide/quickstart', '/guide/config/overview'];

/**
 * Scrolls well down the page, and proves it got there.
 *
 * These tests only mean anything once the viewport and the header's box have
 * separated, so the distance is asserted rather than assumed — a page too short
 * to scroll would pass every one of them without testing what they name.
 *
 * Both waits are polled rather than slept through. `load` fires before the last
 * of the content has been laid out, and scrolling a document that is still one
 * viewport tall silently does nothing: the first version of this helper read
 * back `scrollY: 0` and the assertion below is what caught it.
 */
async function scrollDown(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThan(200);

  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));

  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(100);
}

test.describe('overlays are fixed to the viewport, not to the header', () => {
  test.skip(({ isMobile }) => !isMobile, 'the drawer and its trigger are mobile-only');

  /*
   * The drawer is `position: fixed`, and it is rendered inside the header. The
   * header has a `backdrop-filter`, which makes it the containing block for its
   * fixed descendants — so `inset: 0` resolved against a 48px bar instead of
   * the viewport, and the drawer opened as a sliver at the top of the screen.
   *
   * Asserted against the viewport's own height rather than a constant: what
   * went wrong was the drawer being measured against the wrong box, so the
   * assertion has to name the box it should have been measured against.
   */
  test('the drawer fills the viewport when opened part-way down a page', async ({ page }) => {
    await page.goto('/guide/quickstart');
    await scrollDown(page);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeVisible();

    const viewport = page.viewportSize()!;
    const root = page.locator('.zellij-drawer-root');
    const box = (await root.boundingBox())!;

    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.height)).toBe(viewport.height);

    // The CTA is the part that went missing: pinned to the drawer's bottom, it
    // ended up above the fold when the drawer was measured against the header.
    const cta = (await page.locator('.zellij-drawer-cta').boundingBox())!;
    expect(cta.y).toBeGreaterThan(viewport.height / 2);
    expect(cta.y + cta.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  /*
   * The search overlay is the same component shape in the same place, and was
   * broken the same way — 80px tall against a 664px viewport. Opened with the
   * keyboard because the nav's trigger is desktop-only in this site.
   */
  test('the search overlay fills the viewport when opened part-way down a page', async ({
    page,
  }) => {
    await page.goto('/guide/quickstart');
    await scrollDown(page);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Search the guide' })).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = (await page.locator('.zellij-search-root').boundingBox())!;

    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.height)).toBe(viewport.height);
  });
});

test.describe('nothing overflows a phone sideways', () => {
  test.skip(({ isMobile }) => !isMobile, 'a narrow viewport is the point');

  /*
   * A page that scrolls horizontally is always a defect: there is no
   * horizontal navigation anywhere in the design, so any sideways scroll is
   * something that failed to fit and said nothing about it.
   *
   * Checked at the document rather than per element, deliberately. Elements
   * legitimately exceed the viewport — a wide table inside its scroll
   * container, a section revealing itself from a 36px translate — and only the
   * document tells you whether any of that escaped.
   */
  for (const route of ROUTES) {
    test(`${route} fits the viewport`, async ({ page }) => {
      await page.goto(route);
      // Let entrance animations settle; mid-transform elements are wider than
      // where they land.
      await page.waitForTimeout(400);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(scrollWidth, `${route} scrolls sideways by ${scrollWidth - clientWidth}px`).toBeLessThanOrEqual(
        clientWidth + 1,
      );
    });
  }

  /*
   * A callout is a flex container, so its body takes the automatic minimum size
   * of a flex item — its min-content width. Anything wider than the callout
   * therefore pushed the callout out instead of scrolling inside it, and a
   * reference table with three column minimums is far wider than a phone.
   */
  test('a wide table inside a callout scrolls rather than widening it', async ({ page }) => {
    await page.goto('/guide/quickstart');

    const table = page.locator('.zellij-callout table').first();
    test.skip((await table.count()) === 0, 'this page has no table inside a callout');

    const metrics = await table.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      calloutFits:
        el.closest('.zellij-callout')!.getBoundingClientRect().right <=
        document.documentElement.clientWidth + 1,
    }));

    expect(metrics.calloutFits).toBe(true);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  });
});
